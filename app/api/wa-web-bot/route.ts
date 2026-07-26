export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { sendPushToShop } from "@/lib/webPush";

/**
 * WhatsApp Web bot endpoint.
 *
 * The Meta Cloud API bot lives in /api/bot-webhook and is intentionally left
 * UNTOUCHED. This is a parallel implementation for `connection_mode = whatsapp_web`
 * businesses. The bridge server calls this after storing an inbound customer
 * message. We generate the AI reply here (OpenAI key + DB live on Vercel) and
 * return { bubbles, images } for the bridge to send through the live WA session.
 *
 * Auth: x-bridge-secret header must match BAILEYS_BRIDGE_SECRET.
 */

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type ProductRow = {
  id?: string;
  name: string;
  images?: string | string[] | null;
  stock_count?: number;
  category?: string | null;
  price?: number | null;
  description?: string | null;
  sizes?: string[] | null;
};
type HistMsg = { role: string; content: string };
type BotMode = "full_ecommerce" | "reviews_only" | "info_only";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (copied from bot-webhook — pure functions, safe to duplicate)
// ─────────────────────────────────────────────────────────────────────────────
function resolveProduct(nameHint: string, products: ProductRow[] | null | undefined): ProductRow | undefined {
  if (!products?.length) return undefined;
  const q = nameHint.trim().toLowerCase();
  if (!q) return undefined;
  const exact = products.find((p) => p.name.trim().toLowerCase() === q);
  if (exact) return exact;
  const partial = products.find((p) => {
    const n = p.name.trim().toLowerCase();
    return n.includes(q) || q.includes(n);
  });
  if (partial) return partial;
  const words = q.split(/\s+/).filter((w) => w.length > 2);
  if (!words.length) return undefined;
  return products.find((p) => {
    const n = p.name.trim().toLowerCase();
    return words.some((w) => n.includes(w));
  });
}

function extractProductImageUrls(product: ProductRow): string[] {
  if (!product.images) return [];
  const raw = Array.isArray(product.images)
    ? product.images
    : String(product.images).replace(/[{}]/g, "").split(",");
  return raw.map((u) => u.trim().replace(/^"|"$/g, "")).filter((u) => u.startsWith("http"));
}

function userWantsProductPhotos(text: string): boolean {
  return /photo|photos|pics?|pictures?|image|balanna|pennannam|pennanna|display|show me|pic ekak|photo ekak|pictures ekak/i.test(text);
}

function inferDiscussedProduct(
  currentText: string,
  history: HistMsg[],
  products: ProductRow[] | null | undefined,
): ProductRow | undefined {
  if (!products?.length) return undefined;
  const blob = [currentText, ...history.slice(0, 14).map((m) => m.content)].join("\n").toLowerCase();
  let best: ProductRow | undefined;
  let bestLen = 0;
  for (const p of products) {
    const n = p.name.trim().toLowerCase();
    if (blob.includes(n) && n.length > bestLen) {
      best = p;
      bestLen = n.length;
    }
  }
  return best;
}

function customerUsesSinglish(text: string, history: HistMsg[]): boolean {
  if (/[\u0D80-\u0DFF]/.test(text)) return true;
  const blob = [text, ...history.slice(0, 8).map((m) => m.content)].join("\n").toLowerCase();
  if (/english please|speak english|in english/i.test(blob)) return false;
  if (/[\u0D80-\u0DFF]/.test(blob)) return true;
  return /api gawa|thiyan|thiyen|oyata|oya |mama |denna|puluwan|nehe|hari|ow\b|danata|eka\b|balanna|kohomada|mona |meka |puluwand|rs\./i.test(blob);
}

function userWantsReviews(text: string): boolean {
  return /reviews?|feedback|balanna|ratings?|testimonial|reviews ekak|customer.*say|happy customer/i.test(text);
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — bridge calls this with an inbound customer message
// Body: { shop_id, phone_number, text }
// Returns: { ok, bubbles: string[], images: string[] }
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // Auth
  const secret = process.env.BAILEYS_BRIDGE_SECRET || "";
  if (secret && req.headers.get("x-bridge-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { shop_id?: string; phone_number?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const shopId = String(body.shop_id ?? "").trim();
  const fromCustomer = String(body.phone_number ?? "").replace(/[^\d]/g, "");
  const customerMessageText = String(body.text ?? "").trim();

  if (!shopId || !fromCustomer || !customerMessageText) {
    return NextResponse.json({ ok: false, error: "Missing fields" }, { status: 400 });
  }

  try {
    // ── Tenant lookup ────────────────────────────────────────────────────────
    const { data: business } = await supabaseAdmin
      .from("businesses")
      .select(
        "id, business_name, brand_voice, bot_mode, bot_enabled, enable_ordering, enable_reviews, billing_plan, connection_mode, reviews_link",
      )
      .eq("id", shopId)
      .maybeSingle();

    if (!business) return NextResponse.json({ ok: false, error: "No business" }, { status: 404 });

    // Only run for WhatsApp Web businesses (Meta path is handled elsewhere).
    if ((business as { connection_mode?: string }).connection_mode !== "whatsapp_web") {
      return NextResponse.json({ ok: true, bubbles: [], images: [] });
    }

    // Master bot switch
    if ((business as { bot_enabled?: boolean }).bot_enabled === false) {
      return NextResponse.json({ ok: true, bubbles: [], images: [] });
    }

    const botMode: BotMode = ((business as { bot_mode?: BotMode }).bot_mode as BotMode) || "full_ecommerce";
    const orderingEnabled = botMode === "full_ecommerce" && (business as { enable_ordering?: boolean }).enable_ordering !== false;
    const reviewsEnabled = (business as { enable_reviews?: boolean }).enable_reviews === true || botMode === "reviews_only";

    // ── Customer lookup / create ──────────────────────────────────────────────
    let { data: customer } = await supabaseAdmin
      .from("customers")
      .select("*")
      .eq("phone_number", fromCustomer)
      .eq("shop_id", shopId)
      .maybeSingle();
    if (!customer) {
      const { data: newCust } = await supabaseAdmin
        .from("customers")
        .insert({ phone_number: fromCustomer, shop_id: shopId, bot_active: true })
        .select()
        .single();
      customer = newCust;
    }

    // Human-handoff kill switch (per customer)
    if (customer && customer.bot_active === false) {
      const reactivate = /^(active|activate|bot|start bot|enable bot)$/i;
      if (reactivate.test(customerMessageText)) {
        await supabaseAdmin.from("customers").update({ bot_active: true }).eq("id", customer.id);
        const msg = "Bot activated! How can I help you?";
        await supabaseAdmin.from("messages").insert([
          { phone_number: fromCustomer, role: "model", content: msg, shop_id: shopId },
        ]);
        return NextResponse.json({ ok: true, bubbles: [msg], images: [] });
      }
      // Bot paused — do not reply (the inbound message was already stored by the bridge).
      return NextResponse.json({ ok: true, bubbles: [], images: [] });
    }

    // ── Quota check (dynamic plan limits) ──────────────────────────────────────
    try {
      const { getPlanMessageLimit, getPlanServiceConvoCap } = await import("@/lib/plansDb");
      const planName = (business as { billing_plan?: string }).billing_plan || "Starter";
      const planLimit = await getPlanMessageLimit(planName);
      const serviceConvoCap = await getPlanServiceConvoCap(planName);
      const hardCap = planLimit + Math.floor(planLimit * 0.1);

      const { data: usageRow } = await supabaseAdmin
        .from("businesses")
        .select("billing_messages_used_period, billing_quota_hard_block, billing_service_convos")
        .eq("id", shopId)
        .maybeSingle();
      const used = (usageRow as { billing_messages_used_period?: number })?.billing_messages_used_period ?? 0;
      const hardBlock = (usageRow as { billing_quota_hard_block?: boolean })?.billing_quota_hard_block ?? false;
      const serviceConvos = (usageRow as { billing_service_convos?: number })?.billing_service_convos ?? 0;

      if (hardBlock || used >= hardCap || serviceConvos >= serviceConvoCap) {
        // Over quota — do not reply (message already stored by bridge).
        return NextResponse.json({ ok: true, bubbles: [], images: [] });
      }
      await supabaseAdmin
        .from("businesses")
        .update({ billing_messages_used_period: used + 1 })
        .eq("id", shopId);

      // Track unique service conversations
      const { error: convoErr } = await supabaseAdmin
        .from("conversation_tracker")
        .upsert(
          { shop_id: shopId, phone_number: fromCustomer, convo_type: "service" },
          { onConflict: "shop_id,phone_number,convo_type", ignoreDuplicates: true },
        );
      if (!convoErr) {
        const { count } = await supabaseAdmin
          .from("conversation_tracker")
          .select("*", { count: "exact", head: true })
          .eq("shop_id", shopId)
          .eq("convo_type", "service");
        if (count !== null) {
          await supabaseAdmin.from("businesses").update({ billing_service_convos: count }).eq("id", shopId);
        }
      }
    } catch (quotaErr) {
      console.warn("[wa-web-bot] quota check failed (non-blocking):", quotaErr);
    }

    // ── Fetch products, pending order, history, reviews ────────────────────────
    const [{ data: allProducts }, pendingOrderResult, { data: history }, reviewsResult] =
      await Promise.all([
        supabaseAdmin.from("products").select("*").eq("shop_id", shopId),
        orderingEnabled
          ? supabaseAdmin
              .from("orders")
              .select("*")
              .eq("customer_phone", fromCustomer)
              .eq("shop_id", shopId)
              .eq("status", "Pending")
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        supabaseAdmin
          .from("messages")
          .select("role, content")
          .eq("phone_number", fromCustomer)
          .eq("shop_id", shopId)
          .order("created_at", { ascending: false })
          .limit(12),
        reviewsEnabled
          ? supabaseAdmin
              .from("reviews")
              .select("image_url")
              .eq("shop_id", shopId)
              .order("sort_order", { ascending: true })
              .limit(6)
          : Promise.resolve({ data: null }),
      ]);

    const pendingOrder = (pendingOrderResult as { data: Record<string, unknown> | null }).data;
    const validHistory: HistMsg[] = history || [];
    const reviewImageUrls = ((reviewsResult.data ?? []) as Array<{ image_url: string }>)
      .map((r) => r.image_url)
      .filter(Boolean);
    const reviewsLink = ((business as { reviews_link?: string | null }).reviews_link || "").trim();

    // ── Human-handoff / cancel intent ──────────────────────────────────────────
    const lowerMessage = customerMessageText.toLowerCase();
    const wantsCancel = /cancel|order.*epa|epa.*order|order.*nathi|nathi.*order|cancel karanna|order eka cancel|order cancel|need to cancel|i want to cancel/i.test(lowerMessage);
    const useSinglish = customerUsesSinglish(customerMessageText, validHistory);

    if (lowerMessage.match(/human|manager|call|owner|representative/) || wantsCancel) {
      await supabaseAdmin
        .from("customers")
        .update({ bot_active: false })
        .eq("phone_number", fromCustomer)
        .eq("shop_id", shopId);
      const handoffMsg = useSinglish
        ? "හරි, representative කෙනෙක්ට transfer කරනවා. Bot activate කරන්න 'active' type කරන්න."
        : "I will transfer you to a representative. Type 'active' to reactivate the bot anytime.";
      await supabaseAdmin.from("messages").insert([
        { phone_number: fromCustomer, role: "model", content: handoffMsg, shop_id: shopId },
      ]);
      await sendPushToShop(shopId, {
        title: "Human help needed",
        body: `Customer ${fromCustomer} asked for a representative. Bot paused.`,
        url: "/messages",
        tag: `handoff:${fromCustomer}`,
      }).catch(() => {});
      return NextResponse.json({ ok: true, bubbles: [handoffMsg], images: [] });
    }

    // ── Build prompt ───────────────────────────────────────────────────────────
    const reviewIntent = reviewsEnabled && userWantsReviews(customerMessageText);
    const openAiMessages = [...validHistory].reverse().map((m) => ({
      role: m.role === "user" ? ("user" as const) : ("assistant" as const),
      content: m.content.startsWith("wa-media:") ? "[User sent an attachment]" : m.content,
    }));

    const uniqueCategories = Array.from(new Set((allProducts ?? []).map((p) => p.category).filter(Boolean)));
    const inventoryText =
      `TOTAL PRODUCTS: ${allProducts?.length || 0}\nAVAILABLE CATEGORIES: ${uniqueCategories.join(", ")}\n\n` +
      (allProducts?.length
        ? allProducts
            .map(
              (p) =>
                `- [${p.category}] ${p.name}: Rs.${p.price} | Desc: ${p.description || "No description"} | Sizes: ${p.sizes?.join("/") || "N/A"} | Stock: ${p.stock_count}`,
            )
            .join("\n")
        : "No items.");
    const attachNameList = allProducts?.length ? allProducts.map((p) => `"${p.name}"`).join(", ") : "none";

    const detectedLanguage = useSinglish ? "SINHALA" : "ENGLISH";
    const languageInstruction = `CURRENT MESSAGE LANGUAGE: ${detectedLanguage}. You MUST reply in ${detectedLanguage === "ENGLISH" ? "100% English (no Sinhala/Singlish words at all)" : "proper Sinhala Unicode script (සිංහල අකුරු). Do NOT reply in romanized Singlish — write in actual Sinhala letters"}.`;
    const greetingRule =
      validHistory.length === 0
        ? `FIRST MESSAGE (CRITICAL): Start with "This is an automated AI chatbot. Welcome to ${business.business_name}! How may I help you?" — one line. Then answer anything they asked.`
        : `ONGOING CHAT: No "Hello/Hi" opener. Jump straight into a natural reply.`;

    let modeInstruction = "";
    if (botMode === "info_only") {
      modeInstruction = `BOT MODE: INFORMATION ONLY. You cannot take orders or payments. Focus on FAQ, store info, product info. Do NOT output order tags.`;
    } else if (botMode === "reviews_only") {
      modeInstruction = `BOT MODE: REVIEWS. Build trust with review screenshots. When asked about reviews output [SEND_REVIEWS]. Do NOT take orders in chat.`;
    } else {
      modeInstruction = `BOT MODE: FULL E-COMMERCE. Ordering, sizing, address checking and hidden order tags are ACTIVE.`;
    }

    const reviewIntentPrompt = reviewIntent
      ? `\nREVIEW REQUEST DETECTED. You have ${reviewImageUrls.length} review screenshot(s).${reviewsLink ? ` Reviews link: ${reviewsLink}` : ""} Output [SEND_REVIEWS] and nothing else.`
      : "";

    const activeOrderRules =
      orderingEnabled && pendingOrder
        ? `ACTIVE ORDER: pending order for "${pendingOrder.product_name}" to "${pendingOrder.delivery_address}". If they change address output [UPDATE_ADDRESS: new address]. If they cancel output [CANCEL_ORDER].`
        : orderingEnabled
          ? `NEW ORDER: no active orders. Collect order details when they want to buy.`
          : "";

    const ecommerceTags = orderingEnabled
      ? `SYSTEM COMMANDS (MANDATORY):
      - Attach a product image: [ATTACH_PRODUCT: Exact Product Name]
      - Finalize a NEW order:
        [ORDER_ITEMS: 1x Product Name]
        [TOTAL_PRICE: 12000]
        [PAYMENT_METHOD: COD/Bank Transfer]
        [DELIVERY_ADDRESS: Full Address Here]
      - Handoff to human: output EXACTLY [HUMAN_HANDOFF] for bulk/wholesale, custom items, discounts, or angry customers.
      PRODUCT PHOTOS: exact names for [ATTACH_PRODUCT: ...]: ${attachNameList}. One tag per product (up to 4 images).`
      : `PHOTOS: show product photos via [ATTACH_PRODUCT: Exact Product Name]. Exact names: ${attachNameList}. HANDOFF: output [HUMAN_HANDOFF] if angry or wants a human.`;

    const systemInstruction = `${languageInstruction}

SHOP IDENTITY: Your name is "${business.business_name}". You are a public retail store.

${modeInstruction}
${reviewIntentPrompt}

YOU ARE A REAL HUMAN SHOP PERSON ON WHATSAPP (not a bot):
- Read their last message and answer EVERY question. Short, texting-style lines.
- Match their language exactly. English message → English reply. Singlish/Sinhala → proper Sinhala Unicode (සිංහල), never romanized.
- Never say "I didn't catch that" in Sinhala chats — use natural Sinhala.
- Keep Sinhala short (1-2 lines). Don't translate product names, sizes, Rs amounts, or English tech words (COD, delivery, size).
- BANNED words: machan, ela, patta, bro, boss, mate, dude.
- Use || to split into 2-4 short WhatsApp bubbles.

${ecommerceTags}

${activeOrderRules}
${greetingRule}

BUSINESS BRAND VOICE:
${business.brand_voice || "Assist the customer politely."}

COURIER/DELIVERY: If asked about courier/delivery cost, reply "Courier charge එකක් නෑ, delivery එක Free" (Sinhala) or "No courier charge, delivery is free" (English).

INVENTORY (only offer items with Stock > 0):
${inventoryText}`;

    // ── OpenAI ─────────────────────────────────────────────────────────────────
    const aiModel = useSinglish ? "gpt-4.1" : "gpt-4.1-mini";
    const response = await getOpenAI().chat.completions.create({
      model: aiModel,
      messages: [
        { role: "system", content: systemInstruction },
        ...openAiMessages,
        { role: "user", content: customerMessageText },
      ],
      temperature: 0.85,
      frequency_penalty: 0.25,
      presence_penalty: 0.1,
    });
    const rawAiResponse = response.choices[0].message.content || "";

    // ── Human handoff tag ──────────────────────────────────────────────────────
    if (rawAiResponse.includes("[HUMAN_HANDOFF]")) {
      await supabaseAdmin
        .from("customers")
        .update({ bot_active: false })
        .eq("phone_number", fromCustomer)
        .eq("shop_id", shopId);
      const handoffText = "I will transfer you to a representative. Type 'active' to reactivate the bot anytime.";
      await supabaseAdmin.from("messages").insert([
        { phone_number: fromCustomer, role: "model", content: handoffText, shop_id: shopId },
      ]);
      await sendPushToShop(shopId, {
        title: "Human help needed",
        body: `Customer ${fromCustomer} needs a representative. Bot paused.`,
        url: "/messages",
        tag: `handoff:${fromCustomer}`,
      }).catch(() => {});
      return NextResponse.json({ ok: true, bubbles: [handoffText], images: [] });
    }

    // ── Order DB actions ───────────────────────────────────────────────────────
    if (orderingEnabled) {
      if (rawAiResponse.includes("[CANCEL_ORDER]") && pendingOrder) {
        await supabaseAdmin.from("orders").delete().eq("id", pendingOrder.id as string);
        if (pendingOrder.product_name && allProducts) {
          for (const line of String(pendingOrder.product_name).split(",")) {
            const qtyMatch = line.trim().match(/^(\d+)\s*x\s*(.+)$/i);
            const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
            const searchName = qtyMatch ? qtyMatch[2].trim() : line.trim();
            const item = allProducts.find((p) => p.name.toLowerCase().includes(searchName.toLowerCase()));
            if (item) await supabaseAdmin.from("products").update({ stock_count: (item.stock_count ?? 0) + qty }).eq("id", item.id as string);
          }
        }
      } else if (rawAiResponse.includes("[UPDATE_ADDRESS:") && pendingOrder) {
        const m = rawAiResponse.match(/\[UPDATE_ADDRESS:\s*([\s\S]*?)\]/i);
        if (m) await supabaseAdmin.from("orders").update({ delivery_address: m[1].trim().replace(/\]/g, "") }).eq("id", pendingOrder.id as string);
      } else if (!pendingOrder && rawAiResponse.includes("[ORDER_ITEMS:")) {
        const itemsMatch = rawAiResponse.match(/\[ORDER_ITEMS:\s*([\s\S]*?)\]/);
        const priceMatch = rawAiResponse.match(/\[TOTAL_PRICE:\s*([\d.]+)\]/);
        const paymentMatch = rawAiResponse.match(/\[PAYMENT_METHOD:\s*([\s\S]*?)\]/i);
        const addressMatch = rawAiResponse.match(/\[DELIVERY_ADDRESS:\s*([\s\S]*?)\]/i);
        const extractedItemsStr = itemsMatch ? itemsMatch[1].trim() : "";
        const totalPrice = priceMatch ? parseFloat(priceMatch[1]) : 0;
        const extractedPayment = paymentMatch ? paymentMatch[1].trim() : "Unknown";
        const finalAddress = addressMatch ? addressMatch[1].trim() : "Address not provided";
        if (extractedItemsStr && finalAddress !== "Address not provided") {
          await supabaseAdmin.from("orders").insert({
            shop_id: shopId,
            customer_phone: fromCustomer,
            product_name: extractedItemsStr,
            total_price: totalPrice,
            delivery_address: finalAddress,
            payment_method: extractedPayment,
            status: "Pending",
          });
          await sendPushToShop(shopId, {
            title: "New order",
            body: `${extractedItemsStr} • ${fromCustomer}`,
            url: "/orders",
            tag: `order:${fromCustomer}:${Date.now()}`,
          }).catch(() => {});
          if (allProducts) {
            for (const line of extractedItemsStr.split(",")) {
              const qtyMatch = line.trim().match(/^(\d+)\s*x\s*(.+)$/i);
              const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
              const searchName = qtyMatch ? qtyMatch[2].trim() : line.trim();
              const item = allProducts.find((p) => p.name.toLowerCase().includes(searchName.toLowerCase()));
              if (item && (item.stock_count ?? 0) > 0) {
                await supabaseAdmin.from("products").update({ stock_count: Math.max(0, (item.stock_count ?? 0) - qty) }).eq("id", item.id as string);
              }
            }
          }
        }
      }
    }

    // ── Resolve images & clean text ────────────────────────────────────────────
    const images: string[] = [];
    const attachRegex = /\[ATTACH_PRODUCT:\s*(.*?)\]/gi;
    let match: RegExpExecArray | null;
    while ((match = attachRegex.exec(rawAiResponse)) !== null) {
      const product = resolveProduct(match[1], allProducts);
      if (product) images.push(...extractProductImageUrls(product));
    }
    if (rawAiResponse.includes("[SEND_REVIEWS]") && reviewImageUrls.length > 0) {
      images.push(...reviewImageUrls.slice(0, 6));
    }
    if (userWantsProductPhotos(customerMessageText) && images.length === 0 && allProducts?.length) {
      const discussed = inferDiscussedProduct(customerMessageText, validHistory, allProducts);
      if (discussed) images.push(...extractProductImageUrls(discussed));
    }

    const cleanText = rawAiResponse
      .replace(/\[ATTACH_PRODUCT:.*?\]/gi, "")
      .replace(/\[ORDER_ITEMS:.*?\]/gi, "")
      .replace(/\[TOTAL_PRICE:.*?\]/gi, "")
      .replace(/\[PAYMENT_METHOD:.*?\]/gi, "")
      .replace(/\[DELIVERY_ADDRESS:.*?\]/gi, "")
      .replace(/\[UPDATE_ADDRESS:.*?\]/gi, "")
      .replace(/\[CANCEL_ORDER\]/gi, "")
      .replace(/\[SEND_REVIEWS\]/gi, "")
      .trim();

    const bubbles = cleanText.split("||").map((t) => t.trim()).filter((t) => t.length > 0);

    // Store the model reply (text) so it shows in the dashboard.
    if (cleanText) {
      await supabaseAdmin.from("messages").insert([
        { phone_number: fromCustomer, role: "model", content: rawAiResponse, shop_id: shopId },
      ]);
    }

    return NextResponse.json({
      ok: true,
      bubbles,
      images: images.slice(0, 4),
      reviews_link: rawAiResponse.includes("[SEND_REVIEWS]") ? reviewsLink : "",
    });
  } catch (err) {
    console.error("[wa-web-bot] error:", err);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
