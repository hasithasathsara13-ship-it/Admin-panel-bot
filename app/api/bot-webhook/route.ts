export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { sendPushToShop } from "@/lib/webPush";

// OpenAI is global (one platform key); Meta credentials are resolved per-business.
let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type UserContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type ChatTurn = { role: "user" | "assistant"; content: string };
type HistMsg = { role: string; content: string };
type ProductRow = {
  name: string;
  images?: string | string[] | null;
  stock_count?: number;
  category?: string | null;
  price?: number | null;
  description?: string | null;
  sizes?: string[] | null;
};

type BotMode = "full_ecommerce" | "reviews_only" | "info_only";

type Business = {
  id: string;
  business_name: string | null;
  brand_voice: string | null;
  meta_api_token: string | null;
  meta_phone_id: string | null;
  meta_phone_number_id?: string | null;
  whatsapp_number: string | null;
  bot_mode: BotMode | null;
  bot_enabled: boolean | null;
  enable_ordering: boolean | null;
  enable_reviews: boolean | null;
  billing_plan: string | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp verification (GET)
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verify =
    process.env.WEBHOOK_VERIFY_TOKEN?.trim() ||
    process.env.META_WEBHOOK_VERIFY_TOKEN?.trim();

  if (mode === "subscribe" && token === verify) {
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp helpers — all credentials are passed in (no globals)
// ─────────────────────────────────────────────────────────────────────────────
async function sendWhatsAppText(phoneId: string, token: string, to: string, text: string): Promise<string | null> {
  try {
    const res = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } }),
    });
    if (res.ok) {
      try {
        const data = (await res.json()) as { messages?: Array<{ id?: string }> };
        return data?.messages?.[0]?.id ?? null;
      } catch { return null; }
    }
    return null;
  } catch (error) {
    console.error("❌ META API ERROR (text):", error);
    return null;
  }
}

async function sendWhatsAppImage(phoneId: string, token: string, to: string, imageUrl: string) {
  try {
    await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "image", image: { link: imageUrl } }),
    });
  } catch (error) {
    console.error("❌ META API ERROR (image):", error);
  }
}

async function getMetaMediaBase64(
  mediaId: string,
  token: string,
): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const urlResponse = await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const urlData = await urlResponse.json();
    if (!urlData.url) return null;

    const imageResponse = await fetch(urlData.url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const arrayBuffer = await imageResponse.arrayBuffer();

    return {
      base64: Buffer.from(arrayBuffer).toString("base64"),
      mimeType: urlData.mime_type || "application/octet-stream",
    };
  } catch {
    return null;
  }
}

function mimeToAudioExt(mime: string): { ext: string; type: string } {
  if (mime.includes("mpeg") || mime.includes("mp3")) return { ext: "mp3", type: "audio/mpeg" };
  if (mime.includes("mp4") || mime.includes("m4a")) return { ext: "m4a", type: "audio/mp4" };
  if (mime.includes("webm")) return { ext: "webm", type: "audio/webm" };
  return { ext: "ogg", type: mime || "audio/ogg" };
}

function buildWhisperPrompt(productNames: string[]): string {
  const names = productNames.slice(0, 12).join(", ");
  return [
    "Sinhala, Singlish, Sri Lankan WhatsApp shop voice.",
    "Common: api gawa, thiyanawa, thiyenne, danata, oyata, oya, denna, puluwan, nehe, hari, ow, eka, size, COD, bank transfer, delivery, address, photo, balanna, pennanna, Rs.",
    names ? `Products: ${names}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function isWeakTranscript(text: string): boolean {
  const t = text.trim();
  if (t.length < 2) return true;
  if (/^[\s.,!?…\-]+$/u.test(t)) return true;
  return false;
}

async function getMetaAudioTranscript(
  mediaId: string,
  token: string,
  productNames: string[] = [],
): Promise<string | null> {
  try {
    const urlResponse = await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const urlData = await urlResponse.json();
    if (!urlData.url) return null;

    const audioResponse = await fetch(urlData.url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const mime = (urlData.mime_type as string) || "audio/ogg";
    const { ext, type } = mimeToAudioExt(mime);
    const blob = await audioResponse.blob();
    const file = new File([blob], `voice.${ext}`, { type });

    const transcription = await getOpenAI().audio.transcriptions.create({
      file,
      model: "whisper-1",
      prompt: buildWhisperPrompt(productNames),
    });

    const text = transcription.text?.trim() || "";
    if (isWeakTranscript(text)) return null;
    return text;
  } catch (error) {
    console.error("❌ WHISPER API ERROR:", error);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Product / intent helpers (unchanged logic)
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

function userConfirmedPhotoSend(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /^(ow|yes|ok|okay|hari|danna|ewanna|yep|sure|please|pls)\b|balanna|pennanna|danna|ewanna/i.test(t);
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
  // Actual Sinhala Unicode script in the CURRENT message → always Sinhala
  if (/[\u0D80-\u0DFF]/.test(text)) return true;
  const blob = [text, ...history.slice(0, 8).map((m) => m.content)].join("\n").toLowerCase();
  if (/english please|speak english|in english/i.test(blob)) return false;
  // Sinhala Unicode anywhere in recent history
  if (/[\u0D80-\u0DFF]/.test(blob)) return true;
  return /api gawa|thiyan|thiyen|oyata|oya |mama |denna|puluwan|nehe|hari|ow\b|danata|eka\b|balanna|kohomada|mona |meka |puluwand|rs\./i.test(blob);
}

function userWantsReviews(text: string): boolean {
  return /reviews?|feedback|balanna|ratings?|testimonial|reviews ekak|customer.*say|happy customer/i.test(text);
}

function detectCheckoutThreadLock(historyNewestFirst: HistMsg[], pendingOrder: unknown): boolean {
  if (pendingOrder) return true;
  const recent = historyNewestFirst.slice(0, 22);
  const modelBlob = recent.filter((m) => m.role === "model").map((m) => m.content.toLowerCase()).join("\n");
  const payment = /cod|bank transfer|cash on delivery|payment eka karanne|payment method|will you be paying|paying by/.test(modelBlob);
  const address = /delivery detail|delivery address|district|phone number|kalin dapu address|previous address|provide your delivery|name, address/.test(modelBlob);
  const bankProof = /receipt|sampath bank|account:\s*\d|payment proof/.test(modelBlob);
  return payment || address || bankProof;
}

function userExplicitNewProductBrowseIntent(text: string): boolean {
  const t = text.toLowerCase();
  return /what do you sell|what.*sell|api gawa.*thiy|list.*product|all item|all shoe|browse|photos of other|wenath ekak|other product|mata mona mona|show me everything|any other|change (the|to) (product|item|order)/i.test(t);
}

function shouldScheduleCheckoutReminder(cleanVisible: string, rawModel: string): boolean {
  const t = cleanVisible.toLowerCase();
  const raw = rawModel.toLowerCase();
  if (raw.includes("[order_items") || t.includes("your order is confirmed") || t.includes("order eka confirm")) return false;
  const paymentFork =
    t.includes("payment eka karanne") ||
    (t.includes("bank transfer") && (t.includes("cod") || t.includes("cash on delivery"))) ||
    (t.includes("cash on delivery") && t.includes("bank"));
  return (
    paymentFork ||
    (t.includes("delivery") && (t.includes("address") || t.includes("district") || t.includes("phone"))) ||
    (t.includes("district") && t.includes("phone")) ||
    /kalin dapu address|same address|previous address|address ekatada|delivery karanna one address/.test(t) ||
    (t.includes("receipt") && (t.includes("payment") || t.includes("sampath") || t.includes("send the")))
  );
}

/** Build a description of reviews for the AI system prompt. */
function buildReviewsSummary(imageCount: number, link: string): string {
  if (imageCount === 0 && !link) return "";
  return `This business has ${imageCount} customer review screenshot(s) available.${link ? ` Reviews page: ${link}` : ""} When a customer asks about reviews, output [SEND_REVIEWS] to send them.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main webhook (POST)
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (body.object !== "whatsapp_business_account") return new NextResponse("OK", { status: 200 });

    const entry = body.entry?.[0]?.changes?.[0]?.value;

    // ── Handle delivery/read status updates from Meta ─────────────────────────
    // Meta sends these separately from messages — the payload has `statuses` but no `messages`.
    if (entry?.statuses && entry.statuses.length > 0) {
      for (const statusObj of entry.statuses as Array<{ id?: string; status?: string; timestamp?: string }>) {
        const wamid = statusObj.id;
        const metaStatus = statusObj.status; // "sent" | "delivered" | "read" | "failed"
        if (!wamid || !metaStatus) continue;
        if (metaStatus === "failed") continue; // Could map to "error" but we already handle send errors at send-time.
        const deliveryStatus = metaStatus === "read" ? "read" : metaStatus === "delivered" ? "delivered" : "sent";
        await supabaseAdmin
          .from("messages")
          .update({ delivery_status: deliveryStatus })
          .eq("wa_message_id", wamid);
      }
      return new NextResponse("OK", { status: 200 });
    }

    if (!entry?.messages || !entry.messages[0]) return new NextResponse("OK", { status: 200 });

    const messageObj = entry.messages[0];
    const waMid = messageObj.id as string | undefined;

    // Idempotency
    if (waMid) {
      const { error: idemErr } = await supabaseAdmin.from("whatsapp_inbound_message_ids").insert({ message_id: waMid });
      if (idemErr?.code === "23505") return new NextResponse("OK", { status: 200 });
      if (idemErr) console.warn("whatsapp_inbound_message_ids:", idemErr.message);
    }

    const fromCustomer = messageObj.from;
    const businessPhoneNumber = entry.metadata?.display_phone_number;
    const incomingPhoneId = entry.metadata?.phone_number_id;

    // ── 1. DYNAMIC TENANT LOOKUP ────────────────────────────────────────────
    let { data: business } = await supabaseAdmin
      .from("businesses")
      .select(
        "id, business_name, brand_voice, meta_api_token, meta_phone_id, meta_phone_number_id, whatsapp_number, bot_mode, bot_enabled, enable_ordering, enable_reviews, billing_plan",
      )
      .eq("whatsapp_number", `+${businessPhoneNumber}`)
      .single<Business>();

    if (!business) {
      console.warn(`[bot-webhook] No business registered for +${businessPhoneNumber}`);
      return new NextResponse("OK", { status: 200 });
    }

    // Resolve dynamic credentials. meta_phone_id is the canonical column;
    // fall back to the webhook-reported phone id and persist it if missing.
    const token = business.meta_api_token?.trim() || "";
    let phoneId =
      business.meta_phone_id?.trim() ||
      business.meta_phone_number_id?.trim() ||
      incomingPhoneId ||
      "";

    if (!token || !phoneId) {
      console.warn(
        `[bot-webhook] Missing Meta credentials for ${business.business_name} (token=${token ? "✓" : "✗"}, phoneId=${phoneId ? "✓" : "✗"})`,
      );
      return new NextResponse("OK", { status: 200 });
    }

    // Persist the phone id if the DB didn't have it
    if (incomingPhoneId && business.meta_phone_id !== incomingPhoneId) {
      await supabaseAdmin.from("businesses").update({ meta_phone_id: incomingPhoneId }).eq("id", business.id);
      business = { ...business, meta_phone_id: incomingPhoneId };
      phoneId = incomingPhoneId;
    }

    const botMode: BotMode = (business.bot_mode as BotMode) || "full_ecommerce";
    const orderingEnabled = botMode === "full_ecommerce" && business.enable_ordering !== false;
    const reviewsEnabled = business.enable_reviews === true || botMode === "reviews_only";

    // Master switch — bot disabled entirely
    if (business.bot_enabled === false) {
      // Still log the inbound message, but do not reply.
      return new NextResponse("OK", { status: 200 });
    }

    // ── Media / Vision / Audio ──────────────────────────────────────────────
    const userContent: UserContentPart[] = [];
    let dbMessageContent = "";

    if (messageObj.type === "text") {
      dbMessageContent = messageObj.text.body;
      userContent.push({ type: "text", text: dbMessageContent });
    } else if (messageObj.type === "image" || messageObj.type === "document") {
      const mediaData = await getMetaMediaBase64(messageObj[messageObj.type].id, token);
      if (mediaData) {
        dbMessageContent = `wa-media:${messageObj[messageObj.type].id}:${messageObj.type}`;
        const mediaPrompt =
          messageObj.type === "image"
            ? "The customer sent a photo. Reply like a human: briefly acknowledge the image, then if it looks like a product do visual match per brand voice; if it looks like a bank receipt, verify it; if unclear, ask one short friendly question."
            : "The customer sent a document/PDF. Acknowledge it naturally, then check if it's payment proof per brand voice.";
        userContent.push({ type: "text", text: mediaPrompt });
        userContent.push({
          type: "image_url",
          image_url: { url: `data:${mediaData.mimeType};base64,${mediaData.base64}` },
        });
      }
    } else if (messageObj.type === "audio") {
      const mediaId = messageObj.audio?.id as string | undefined;
      if (!mediaId) return new NextResponse("OK", { status: 200 });
      dbMessageContent = `wa-media:${mediaId}:audio`;
    } else {
      return new NextResponse("OK", { status: 200 });
    }

    // ── Customer lookup / create ────────────────────────────────────────────
    let { data: customer } = await supabaseAdmin
      .from("customers")
      .select("*")
      .eq("phone_number", fromCustomer)
      .eq("shop_id", business.id)
      .single();
    if (!customer) {
      const { data: newCust } = await supabaseAdmin
        .from("customers")
        .insert({ phone_number: fromCustomer, shop_id: business.id, bot_active: true })
        .select()
        .single();
      customer = newCust;
    }

    await supabaseAdmin
      .from("customers")
      .update({ checkout_reminder_at: null, checkout_reminder_sent: false })
      .eq("id", customer.id);

    const userRow: Record<string, unknown> = {
      phone_number: fromCustomer,
      role: "user",
      content: dbMessageContent,
      shop_id: business.id,
    };
    if (waMid) userRow.wa_message_id = waMid;

    // Human handoff kill switch (per-customer)
    if (customer && customer.bot_active === false) {
      // Check if user types "active" to reactivate the bot
      const reactivateKeywords = /^(active|activate|bot|start bot|enable bot)$/i;
      if (reactivateKeywords.test(dbMessageContent.trim())) {
        await supabaseAdmin.from("customers").update({ bot_active: true }).eq("id", customer.id);
        const reactivateMsg = "Bot activated! How can I help you?";
        const reactivateWamid = await sendWhatsAppText(phoneId, token, fromCustomer, reactivateMsg);
        await supabaseAdmin.from("messages").insert([
          userRow,
          { phone_number: fromCustomer, role: "model", content: reactivateMsg, shop_id: business.id, wa_message_id: reactivateWamid },
        ]);
        return new NextResponse("OK", { status: 200 });
      }
      await supabaseAdmin.from("messages").insert([userRow]);
      return new NextResponse("OK", { status: 200 });
    }

    // ── Quota check — use dynamic plan limits ───────────────────────────────
    try {
      const { getPlanMessageLimit, getPlanServiceConvoCap } = await import("@/lib/plansDb");
      const planLimit = await getPlanMessageLimit(business.billing_plan || "Starter");
      const serviceConvoCap = await getPlanServiceConvoCap(business.billing_plan || "Starter");
      const bufferRatio = 0.1;
      const hardCap = planLimit + Math.floor(planLimit * bufferRatio);
      // Get current usage from the business row
      const { data: usageRow } = await supabaseAdmin
        .from("businesses")
        .select("billing_messages_used_period, billing_quota_hard_block, billing_service_convos, billing_low_balance_notice_sent")
        .eq("id", business.id)
        .maybeSingle();
      const used = (usageRow as { billing_messages_used_period?: number })?.billing_messages_used_period ?? 0;
      const hardBlock = (usageRow as { billing_quota_hard_block?: boolean })?.billing_quota_hard_block ?? false;
      const serviceConvos = (usageRow as { billing_service_convos?: number })?.billing_service_convos ?? 0;
      const lowBalanceNoticeSent = (usageRow as { billing_low_balance_notice_sent?: boolean })?.billing_low_balance_notice_sent ?? false;

      // Block if: hard block flag set, OR messages exceed hard cap, OR service convos exceed cap
      if (hardBlock || used >= hardCap || serviceConvos >= serviceConvoCap) {
        // Quota exceeded — still log the message but don't reply
        await supabaseAdmin.from("messages").insert([userRow]);
        return new NextResponse("OK", { status: 200 });
      }

      // Increment usage counter
      const newUsed = used + 1;
      await supabaseAdmin
        .from("businesses")
        .update({ billing_messages_used_period: newUsed })
        .eq("id", business.id);

      // ── Low-balance notice — warn the owner when only ~100 plan messages remain ──
      const remaining = planLimit - newUsed;
      if (!lowBalanceNoticeSent && remaining <= 100 && remaining >= 0) {
        // Mark as sent first (prevents duplicate fires under concurrent webhooks)
        await supabaseAdmin
          .from("businesses")
          .update({ billing_low_balance_notice_sent: true })
          .eq("id", business.id);

        // Admin panel push + hidden marker for in-app notification
        await sendPushToShop(business.id, {
          title: "Low message balance",
          body: `Only ~${remaining} bot messages left on your ${business.billing_plan || "Starter"} plan.`,
          url: "/settings",
          tag: `low-balance:${business.id}`,
        });
        await supabaseAdmin.from("messages").insert([
          { phone_number: "system", role: "model", content: `[LOW_BALANCE] Only ${remaining} messages left on ${business.billing_plan || "Starter"} plan`, shop_id: business.id },
        ]);
      }

      // Track unique service conversations for billing
      // Only count once per unique phone number per billing period
      const { error: convoErr } = await supabaseAdmin
        .from("conversation_tracker")
        .upsert(
          { shop_id: business.id, phone_number: fromCustomer, convo_type: "service" },
          { onConflict: "shop_id,phone_number,convo_type", ignoreDuplicates: true }
        );
      if (!convoErr) {
        // If insert succeeded (not duplicate), increment the service convo counter
        // We use a raw count query to keep it accurate
        const { count } = await supabaseAdmin
          .from("conversation_tracker")
          .select("*", { count: "exact", head: true })
          .eq("shop_id", business.id)
          .eq("convo_type", "service");
        if (count !== null) {
          await supabaseAdmin
            .from("businesses")
            .update({ billing_service_convos: count })
            .eq("id", business.id);
        }
      }
    } catch (quotaErr) {
      // Quota check failed — log the error but DO NOT block the message
      console.warn("[bot-webhook] Quota check failed (non-blocking):", quotaErr);
    }

    // ── Data pre-fetching — run all queries in parallel ─────────────────────
    const [
      { data: allProducts },
      pendingOrderResult,
      { data: history },
      reviewsResult,
    ] = await Promise.all([
      supabaseAdmin.from("products").select("*").eq("shop_id", business.id),
      orderingEnabled
        ? supabaseAdmin.from("orders").select("*").eq("customer_phone", fromCustomer).eq("shop_id", business.id).eq("status", "Pending").order("created_at", { ascending: false }).limit(1).single()
        : Promise.resolve({ data: null }),
      supabaseAdmin.from("messages").select("role, content").eq("phone_number", fromCustomer).eq("shop_id", business.id).order("created_at", { ascending: false }).limit(12),
      reviewsEnabled
        ? supabaseAdmin.from("reviews").select("image_url").eq("shop_id", business.id).order("sort_order", { ascending: true }).limit(6)
        : Promise.resolve({ data: null }),
    ]);

    const pendingOrder = pendingOrderResult.data;

    // ── 3a. Conditional review fetching ─────────────────────────────────────
    let reviewsText = "";
    let reviewImageUrls: string[] = [];
    let reviewsLink = "";
    if (reviewsEnabled) {
      reviewImageUrls = ((reviewsResult.data ?? []) as Array<{ image_url: string }>).map((r) => r.image_url).filter(Boolean);

      // Fetch the reviews link from the business
      const { data: bizReviewLink } = await supabaseAdmin
        .from("businesses")
        .select("reviews_link")
        .eq("id", business.id)
        .maybeSingle();
      reviewsLink = (bizReviewLink as { reviews_link?: string | null })?.reviews_link?.trim() || "";

      if (reviewImageUrls.length > 0 || reviewsLink) {
        reviewsText = `This business has ${reviewImageUrls.length} customer review screenshot(s)${reviewsLink ? ` and a reviews page at: ${reviewsLink}` : ""}.`;
      }
    }

    const previousAddress = pendingOrder ? pendingOrder.delivery_address : null;
    const validHistory: HistMsg[] = history || [];
    const productNames = (allProducts ?? []).map((p) => p.name as string);
    let customerMessageText = dbMessageContent;

    // Audio transcription
    if (messageObj.type === "audio") {
      const mediaId = messageObj.audio?.id as string | undefined;
      const audioText = mediaId ? await getMetaAudioTranscript(mediaId, token, productNames) : null;
      const useSinglish = customerUsesSinglish(audioText || "", validHistory);
      if (audioText) {
        customerMessageText = audioText;
        userContent.push({
          type: "text",
          text: `[Customer sent a Sinhala/Singlish voice note — treat this as their exact WhatsApp message. Reply in fluent warm PROPER SINHALA UNICODE (සිංහල අකුරු), NOT romanized Singlish (unless they clearly spoke English). Never mention voice/audio/transcription. Answer every question they asked.${orderingEnabled ? " If they asked for product photos, you MUST output [ATTACH_PRODUCT: Exact Product Name] using inventory spelling." : ""}]: "${audioText}"`,
        });
      } else {
        userContent.push({
          type: "text",
          text: useSinglish
            ? "[Voice note was unclear. Reply ONLY in proper Sinhala Unicode (සිංහල) — e.g. 'Voice එක clear නෑ, type කරන්න පුළුවන්ද?' NEVER use romanized Singlish or English phrases like 'I didn't catch that'.]"
            : "[Voice note was unclear. Ask them politely to type the message — one short friendly line, in the same language they have been using in this chat.]",
        });
      }
    }

    const lowerMessage = customerMessageText.toLowerCase();

    // Explicit human request OR cancel order request
    const wantsCancel = /cancel|order.*epa|epa.*order|order.*nathi|nathi.*order|cancel karanna|order eka cancel|order cancel|need to cancel|i want to cancel/i.test(lowerMessage);
    if (lowerMessage.match(/human|manager|call|owner|representative/) || wantsCancel) {
      if (wantsCancel && pendingOrder) {
        // Check if order is within 2-hour free cancellation window
        const orderCreatedAt = new Date(pendingOrder.created_at).getTime();
        const twoHoursMs = 1 * 60 * 60 * 1000;
        const withinFreeWindow = Date.now() - orderCreatedAt < twoHoursMs;
        const orderStatus = String(pendingOrder.status || "Pending").toLowerCase();
        const isShipped = orderStatus === "shipped" || orderStatus === "delivered";

        if (isShipped) {
          // Order already shipped → handoff to human, cannot auto-cancel
          await supabaseAdmin.from("customers").update({ bot_active: false }).eq("phone_number", fromCustomer).eq("shop_id", business.id);
          const shippedMsg = customerUsesSinglish(customerMessageText, validHistory)
            ? "ඔයාගේ order එක දැනටමත් shipped වෙලා. Cancel කිරීම සඳහා representative කෙනෙක්ට handover කරනවා."
            : "Your order has already been shipped. I'm handing over to a representative to assist with the cancellation.";
          const shippedWamid = await sendWhatsAppText(phoneId, token, fromCustomer, shippedMsg);
          await supabaseAdmin.from("messages").insert([
            userRow,
            { phone_number: fromCustomer, role: "model", content: shippedMsg, shop_id: business.id, wa_message_id: shippedWamid },
          ]);
          await sendPushToShop(business.id, {
            title: "Cancellation needs attention",
            body: `Shipped order — customer ${fromCustomer} wants to cancel. Bot paused.`,
            url: "/messages",
            tag: `cancel-shipped:${fromCustomer}`,
          });
          return new NextResponse("OK", { status: 200 });
        }

        if (withinFreeWindow) {
          // Within window → refund stock silently, delete order, notify customer + admin
          if (pendingOrder.product_name && allProducts) {
            const orderLines = String(pendingOrder.product_name).split(",");
            for (const line of orderLines) {
              const qtyMatch = line.trim().match(/^(\d+)\s*x\s*(.+)$/i);
              const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
              const searchName = qtyMatch ? qtyMatch[2].trim() : line.trim();
              const item = allProducts.find((p: { name: string; stock_count?: number }) =>
                p.name.toLowerCase().includes(searchName.toLowerCase())
              );
              if (item) {
                await supabaseAdmin.from("products").update({ stock_count: (item.stock_count ?? 0) + qty }).eq("id", item.id);
              }
            }
          }

          // Delete the order from the orders page
          await supabaseAdmin.from("orders").delete().eq("id", pendingOrder.id);

          const cancelMsg = customerUsesSinglish(customerMessageText, validHistory)
            ? "ඔයාගේ order එක cancel කරා. වෙන මොනවද help කරන්න පුළුවන්ද?"
            : "Your order has been cancelled. Is there anything else I can help with?";
          const cancelWamid = await sendWhatsAppText(phoneId, token, fromCustomer, cancelMsg);
          await supabaseAdmin.from("messages").insert([
            userRow,
            { phone_number: fromCustomer, role: "model", content: cancelMsg, shop_id: business.id, wa_message_id: cancelWamid },
            // Hidden marker message for admin notification (order cancelled)
            { phone_number: fromCustomer, role: "model", content: `[ORDER_CANCELLED] Order cancelled by customer: ${pendingOrder.product_name}`, shop_id: business.id },
          ]);
          await sendPushToShop(business.id, {
            title: "Order cancelled",
            body: `${pendingOrder.product_name} • ${fromCustomer}`,
            url: "/orders",
            tag: `cancel:${pendingOrder.id}`,
          });
          return new NextResponse("OK", { status: 200 });
        }

        // Outside 2-hour window but not shipped → handoff to human
        await supabaseAdmin.from("customers").update({ bot_active: false }).eq("phone_number", fromCustomer).eq("shop_id", business.id);
        const lateMsg = customerUsesSinglish(customerMessageText, validHistory)
          ? "Order cancel කිරීමට 1 hour window එක ඉවර වෙලා. Representative කෙනෙක්ට handover කරනවා."
          : "The free cancellation window (1 hour) has passed. I'm handing over to a representative to assist.";
        const lateWamid = await sendWhatsAppText(phoneId, token, fromCustomer, lateMsg);
        await supabaseAdmin.from("messages").insert([
          userRow,
          { phone_number: fromCustomer, role: "model", content: lateMsg, shop_id: business.id, wa_message_id: lateWamid },
        ]);
        await sendPushToShop(business.id, {
          title: "Cancellation needs attention",
          body: `Customer ${fromCustomer} wants to cancel (past free window). Bot paused.`,
          url: "/messages",
          tag: `cancel-late:${fromCustomer}`,
        });
        return new NextResponse("OK", { status: 200 });
      }

      // Regular human handoff (not cancel-related)
      await supabaseAdmin.from("customers").update({ bot_active: false }).eq("phone_number", fromCustomer).eq("shop_id", business.id);
      const handoffMsg = customerUsesSinglish(customerMessageText, validHistory)
        ? "හරි, representative කෙනෙක්ට transfer කරනවා. Bot activate කරන්න 'active' type කරන්න."
        : "I will transfer you to a representative. Type 'active' to reactivate the bot anytime.";
      const handoffWamid = await sendWhatsAppText(phoneId, token, fromCustomer, handoffMsg);
      await supabaseAdmin.from("messages").insert([
        userRow,
        { phone_number: fromCustomer, role: "model", content: handoffMsg, shop_id: business.id, wa_message_id: handoffWamid },
      ]);
      await sendPushToShop(business.id, {
        title: "Human help needed",
        body: `Customer ${fromCustomer} asked for a representative. Bot paused.`,
        url: "/messages",
        tag: `handoff:${fromCustomer}`,
      });
      return new NextResponse("OK", { status: 200 });
    }

    // ── 4. Review intent catcher ────────────────────────────────────────────
    const reviewIntent = reviewsEnabled && userWantsReviews(customerMessageText);

    const checkoutThreadLocked = orderingEnabled && detectCheckoutThreadLock(validHistory, pendingOrder);
    const explicitBrowseIntent = userExplicitNewProductBrowseIntent(customerMessageText);
    const checkoutLockPrompt =
      checkoutThreadLocked && !explicitBrowseIntent
        ? `CHECKOUT THREAD LOCK (CRITICAL):
The chat is already in payment and/or delivery details (or this customer has a pending order).
- ONLY handle: confirm address, yes/no to same-as-last address, COD/Bank instructions, payment receipts, small clarifications, cancel or change order.
- FORBIDDEN unless the customer CLEARLY asks to browse/switch products: do NOT list products, do NOT restart browsing from inventory.`
        : "";

    // Conversation history
    const openAiMessages: ChatTurn[] = [...validHistory].reverse().map((msg) => ({
      role: msg.role === "user" ? ("user" as const) : ("assistant" as const),
      content: msg.content.startsWith("wa-media:") ? "[User sent an attachment]" : msg.content,
    }));

    // Inventory text (only built when ordering or reviews need product context)
    const uniqueCategories = Array.from(new Set(allProducts?.map((p) => p.category).filter(Boolean)));
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

    // Detect language BEFORE building the system prompt
    const useSinglish = customerUsesSinglish(customerMessageText, validHistory);

    const greetingRule =
      validHistory.length === 0
        ? `FIRST MESSAGE (CRITICAL): Start with "This is an automated AI chatbot. Welcome to ${business.business_name}! How may I help you?" — keep it exactly like this, one line. Then if they asked anything, answer it after.`
        : `ONGOING CHAT: No "Hello/Hi" opener unless they just said hi after a long gap. Jump straight into a natural reply.`;

    const detectedLanguage = useSinglish ? "SINHALA" : "ENGLISH";
    const languageInstruction = `CURRENT MESSAGE LANGUAGE: ${detectedLanguage}. You MUST reply in ${detectedLanguage === "ENGLISH" ? "100% English (no Sinhala/Singlish words at all)" : "proper Sinhala Unicode script (සිංහල අකුරු). Do NOT reply in romanized Singlish — write in actual Sinhala letters"}.`;

    // ── 3b. Mode-specific behavioral block ──────────────────────────────────
    let modeInstruction = "";
    if (botMode === "info_only") {
      modeInstruction = `BOT MODE: INFORMATION ONLY (STRICT).
- You are strictly an informational assistant for ${business.business_name}.
- You CANNOT take orders, process payments, or run checkout. If asked to order, politely explain ordering is not available through chat and direct them to contact the store directly.
- Do NOT output any order tags ([ORDER_ITEMS:], [TOTAL_PRICE:], etc.).
- Focus entirely on FAQ, store info, opening hours, location, product information, and general questions.
- You may still describe products and prices for information, but never collect address/payment.`;
    } else if (botMode === "reviews_only") {
      modeInstruction = `BOT MODE: REVIEWS / SOCIAL PROOF.
- Your primary job is to build trust using customer review screenshots.
- When customers ask about reviews, output [SEND_REVIEWS] to send them the review images.
- You do NOT take orders in chat. When a customer wants to buy, warmly direct them to place the order (e.g. via the store's order link / contact) — do NOT collect address or payment, do NOT output order tags.
${reviewsText ? `\n${reviewsText}` : "\n(No reviews available yet — be honest, do not fabricate reviews.)"}`;
    } else {
      // full_ecommerce
      modeInstruction = `BOT MODE: FULL E-COMMERCE.
- Ordering, sizing, address checking, inventory checking, and hidden system order tags are ACTIVE.
- Follow the full checkout flow and output the hidden tags exactly as specified below.
${reviewsEnabled && reviewsText ? `\nYou also have customer review screenshots available. If the customer asks about reviews/feedback, output [SEND_REVIEWS] to send them.` : ""}`;
    }

    const reviewIntentPrompt = reviewIntent
      ? `\nREVIEW REQUEST DETECTED: The customer is asking about reviews/feedback/ratings. You have ${reviewImageUrls.length} review screenshot(s) to show them.${reviewsLink ? ` Also share this reviews link: ${reviewsLink}` : ""}\nOutput [SEND_REVIEWS] and NOTHING ELSE. Do NOT add any text like "here are reviews" or "balanna" — the images speak for themselves. Just output [SEND_REVIEWS] only.${!reviewImageUrls.length && !reviewsLink ? "\n(No reviews available yet — just say 'danata reviews nehe, tikak innako' or similar short reply.)" : ""}`
      : "";

    const activeOrderRules =
      orderingEnabled && pendingOrder
        ? `ACTIVE ORDER DETECTED: This customer already has a PENDING order for "${pendingOrder.product_name}" delivering to "${pendingOrder.delivery_address}".
         - IF THEY WANT TO CHANGE ADDRESS: Say "Sure, I've updated your address!" then output EXACTLY [UPDATE_ADDRESS: new address here] at the very end. DO NOT output FINAL CONFIRMATION again.
         - IF THEY WANT TO CANCEL: Say "No problem, I have canceled your order." then output EXACTLY [CANCEL_ORDER] at the very end.`
        : orderingEnabled
          ? `NEW ORDER: The customer has no active orders. Proceed to collect order details when they want to buy.`
          : "";

    const ecommerceTags = orderingEnabled
      ? `SYSTEM COMMANDS (MANDATORY FOR DATABASE):
      - To attach a product image: [ATTACH_PRODUCT: Exact Product Name]
      - To finalize a NEW order:
        [ORDER_ITEMS: 1x Product Name]
        [TOTAL_PRICE: 12000]
        [PAYMENT_METHOD: COD/Bank Transfer]
        [DELIVERY_ADDRESS: Full Address Here]
      - To handoff to a human owner: output EXACTLY [HUMAN_HANDOFF] and nothing else if the customer: requests bulk/wholesale (5+), asks for a custom product not in inventory, asks for a discount, is angry/complaining, or demands a human.

      PRODUCT PHOTOS (MANDATORY):
      - Exact names for [ATTACH_PRODUCT: ...]: ${attachNameList}
      - Copy spelling exactly. One tag per product (system sends up to 4 images).`
      : `PHOTOS: You may still show product photos using [ATTACH_PRODUCT: Exact Product Name]. Exact names: ${attachNameList}.
      HANDOFF: Output EXACTLY [HUMAN_HANDOFF] if the customer is angry, wants a human, or asks something you cannot answer.`;

    const systemInstruction = `${languageInstruction}

      SHOP IDENTITY (CRITICAL):
      Your name is "${business.business_name}". You are a public retail store. If a user asks who you are, proudly tell them your shop name.

      ${modeInstruction}
      ${reviewIntentPrompt}

      YOU ARE A REAL HUMAN SHOP PERSON ON WHATSAPP (not a bot):
      - Read their LAST message carefully. React to their actual words first before moving forward.
      - Answer EVERY question they asked using inventory and common sense. Never skip a question.
      - Sound like texting: short lines, contractions, occasional "sure", "no worries" (English) or natural Singlish fillers — never stiff corporate speak.
      - Match their length and mood. Vary your phrasing; don't repeat canned lines.

      CRITICAL LANGUAGE RULES (ABSOLUTE OVERRIDE — NO EXCEPTIONS):
      THE USER'S CURRENT MESSAGE LANGUAGE DETERMINES YOUR REPLY LANGUAGE. PERIOD.

      DETECT LANGUAGE FROM THE LAST MESSAGE:
      - If last message contains ONLY English words (like "do you have shoes", "what is the price", "yes", "ok") → reply in 100% ENGLISH. Do NOT mix in any Sinhala/Singlish.
      - If last message contains Singlish (romanized Sinhala like "thiyanawada", "kiyada") OR actual Sinhala script → reply in PROPER SINHALA UNICODE SCRIPT (සිංහල අකුරු). NEVER reply in romanized Singlish.
      - "do you have shoes" = ENGLISH → reply in English: "Yes we have shoes! Which brand are you looking for?"
      - "shoes thiyanawada" = SINGLISH → reply in SINHALA: "ඔව් තියනවා! මොන brand එකද ඕන?"
      - "සපත්තු තියනවද" = SINHALA → reply in SINHALA: "ඔව් තියනවා! මොන brand එකද ඕන?"

      EXAMPLES OF ENGLISH TRIGGERS (always reply in English to these):
      - "do you have", "what is", "how much", "yes", "no", "ok", "please", "thank you", "I want", "can I", "show me", "what size", "delivery"

      RULE: If you cannot identify ANY Singlish/Sinhala word in the message, reply in ENGLISH.
      4. VOICE NOTES: treat transcript as their real message. Default to Sinhala (Unicode) unless they clearly spoke English.
      5. BANNED when customer uses Sinhala/Singlish: never say "I didn't catch that", "I didn't understand", "Could you repeat". Use natural Sinhala instead (e.g. "clear නෑ, type කරන්න පුළුවන්ද?").

      SINHALA QUALITY (ONLY WHEN REPLYING IN SINHALA):
      - Write in proper Sinhala Unicode letters (සිංහල), NOT romanized text. This is the #1 rule.
      - KEEP IT SHORT. Sri Lankans text in very short messages. Max 1-2 lines per bubble.
      - Do NOT over-explain. One question at a time. One point per message.
      - Example of TOO LONG: "හරි, ඔයාට size 42 දෙන්න පුළුවන්! මොකක්ද ඔයාගේ interest එකක් — Nike Air force 1 ද, නැත්නම් Nike Air Jordon 1 ද? මොනවා pick කරන්නේ? Payment එක කරන්නේ Cash on Delivery (COD) ද නැතම් Bank Transfer එකක්ද?"
      - Example of CORRECT LENGTH: "ඔව් size 42 තියනවා. මොන shoe එකද ඕන?"
      - Keep it natural and warm like a real Sri Lankan shop person texting in Sinhala.
      - Shop stock = "අපි ගාව ... තියනවා". Out of stock: "දැනට නෑ" + suggest alt.
      - Never translate product names / sizes / Rs. amounts / English tech words (COD, Bank Transfer, delivery, size, photo) into Sinhala — keep those as-is. Mixing English words naturally inside Sinhala sentences is fine and normal.
      - STRICTLY BANNED WORDS: machan, ela, patta, bro, boss, mate, dude, මචන්. NEVER use these.
      - DO NOT send unnecessary text if images/reviews are being sent. Let them speak for themselves.
      - DO NOT ask multiple questions in one message. Ask ONE thing, wait for reply.
      - DO NOT repeat info they already know. Be concise like a real person texting.

      ANTI-SPAM & FLOW:
      - Do not paste the same sentence twice. Use || to split into 2-4 short WhatsApp bubbles.
      ${orderingEnabled ? "- If they ask for photos/balanna/penna, send them in the SAME reply via [ATTACH_PRODUCT: Exact Product Name]." : ""}

      ${ecommerceTags}

      ${activeOrderRules}
      ${greetingRule}

      ${orderingEnabled ? `LAST SAVED DELIVERY ADDRESS (reuse "kalin address" flows; null if none): ${previousAddress ?? "none"}` : ""}

      ${checkoutLockPrompt}

      BUSINESS SPECIFIC BRAND VOICE:
      ${business.brand_voice || "Assist the customer politely with their inquiries."}

      COURIER / DELIVERY CHARGE RULE:
      - If asked about courier/delivery/shipping cost, ALWAYS reply: "Courier charge එකක් නෑ, delivery එක Free" (Sinhala) or "No courier charge, delivery is free" (English) depending on their language.

      INVENTORY:
      - Only offer items if Stock > 0. If 0, say Out of Stock and offer alternatives.
      ${inventoryText}`;

    // ── OpenAI execution ──────────────────────────────────────────────────
    if (checkoutThreadLocked && !explicitBrowseIntent && messageObj.type === "audio") {
      userContent.push({
        type: "text",
        text: "[Checkout already in progress. They are likely answering address/payment/COD — do NOT pivot to listing other products.]",
      });
    }

    // Singlish → gpt-4.1 (best, most natural), English → gpt-4.1-mini (faster)
    const aiModel = useSinglish ? "gpt-4.1" : "gpt-4.1-mini";

    const response = await getOpenAI().chat.completions.create({
      model: aiModel,
      messages: [
        { role: "system", content: systemInstruction },
        ...openAiMessages,
        { role: "user", content: userContent },
      ],
      temperature: 0.85,
      frequency_penalty: 0.25,
      presence_penalty: 0.1,
    });

    const rawAiResponse = response.choices[0].message.content || "";

    // ── Process tags & DB actions ──────────────────────────────────────────
    if (rawAiResponse.includes("[HUMAN_HANDOFF]")) {
      await supabaseAdmin.from("customers").update({ bot_active: false }).eq("phone_number", fromCustomer).eq("shop_id", business.id);
      await supabaseAdmin
        .from("customers")
        .update({ checkout_reminder_at: null, checkout_reminder_sent: false })
        .eq("phone_number", fromCustomer)
        .eq("shop_id", business.id);
      const handoffText = "I will transfer you to a representative. Type 'active' to reactivate the bot anytime.";
      const handoffText2Wamid = await sendWhatsAppText(phoneId, token, fromCustomer, handoffText);
      await supabaseAdmin.from("messages").insert([
        userRow,
        { phone_number: fromCustomer, role: "model", content: handoffText, shop_id: business.id, wa_message_id: handoffText2Wamid },
      ]);
      return new NextResponse("OK", { status: 200 });
    }

    // Standard logging
    await supabaseAdmin.from("messages").insert([
      userRow,
      { phone_number: fromCustomer, role: "model", content: rawAiResponse, shop_id: business.id },
    ]);

    // Order DB actions — only when ordering is enabled
    if (orderingEnabled) {
      if (rawAiResponse.includes("[CANCEL_ORDER]") && pendingOrder) {
        await supabaseAdmin.from("orders").delete().eq("id", pendingOrder.id);
        if (pendingOrder.product_name && allProducts) {
          const orderLines = pendingOrder.product_name.split(",");
          for (const line of orderLines) {
            const qtyMatch = line.trim().match(/^(\d+)\s*x\s*(.+)$/i);
            const qtyToRefund = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
            const searchName = qtyMatch ? qtyMatch[2].trim() : line.trim();
            const item = allProducts.find((p) => p.name.toLowerCase().includes(searchName.toLowerCase()));
            if (item) {
              await supabaseAdmin.from("products").update({ stock_count: item.stock_count + qtyToRefund }).eq("id", item.id);
            }
          }
        }
      } else if (rawAiResponse.includes("[UPDATE_ADDRESS:") && pendingOrder) {
        const updateMatch = rawAiResponse.match(/\[UPDATE_ADDRESS:\s*([\s\S]*?)\]/i);
        if (updateMatch) {
          const newAddress = updateMatch[1].trim().replace(/\]/g, "");
          await supabaseAdmin.from("orders").update({ delivery_address: newAddress }).eq("id", pendingOrder.id);
        }
      } else if (
        !pendingOrder &&
        (rawAiResponse.includes("Order eka confirm kara") ||
          rawAiResponse.includes("Your order is confirmed") ||
          rawAiResponse.includes("[ORDER_ITEMS:"))
      ) {
        const itemsMatch = rawAiResponse.match(/\[ORDER_ITEMS:\s*([\s\S]*?)\]/);
        const priceMatch = rawAiResponse.match(/\[TOTAL_PRICE:\s*([\d.]+)\]/);
        const paymentMatch = rawAiResponse.match(/\[PAYMENT_METHOD:\s*([\s\S]*?)\]/i);
        const addressMatch = rawAiResponse.match(/\[DELIVERY_ADDRESS:\s*([\s\S]*?)\]/i);

        const extractedItemsStr = itemsMatch ? itemsMatch[1].trim() : "";
        const totalPrice = priceMatch ? parseFloat(priceMatch[1]) : 0.0;
        const extractedPayment = paymentMatch ? paymentMatch[1].trim() : "Unknown";
        let finalDeliveryAddress = "Address not provided";
        if (addressMatch) finalDeliveryAddress = addressMatch[1].trim();

        if (extractedItemsStr && finalDeliveryAddress !== "Address not provided") {
          await supabaseAdmin.from("orders").insert({
            shop_id: business.id,
            customer_phone: fromCustomer,
            product_name: extractedItemsStr,
            total_price: totalPrice,
            delivery_address: finalDeliveryAddress,
            payment_method: extractedPayment,
            status: "Pending",
          });

          await sendPushToShop(business.id, {
            title: "New order",
            body: `${extractedItemsStr} • ${fromCustomer}`,
            url: "/orders",
            tag: `order:${fromCustomer}:${Date.now()}`,
          });

          await supabaseAdmin
            .from("customers")
            .update({ checkout_reminder_at: null, checkout_reminder_sent: false })
            .eq("phone_number", fromCustomer)
            .eq("shop_id", business.id);

          if (allProducts) {
            const orderLines = extractedItemsStr.split(",");
            for (const line of orderLines) {
              const qtyMatch = line.trim().match(/^(\d+)\s*x\s*(.+)$/i);
              const qtyToDeduct = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
              const searchName = qtyMatch ? qtyMatch[2].trim() : line.trim();
              const item = allProducts.find((p) => p.name.toLowerCase().includes(searchName.toLowerCase()));
              if (item && item.stock_count > 0) {
                await supabaseAdmin.from("products").update({ stock_count: Math.max(0, item.stock_count - qtyToDeduct) }).eq("id", item.id);
              }
            }
          }
        }
      }
    }

    // ── Sending media & text bubbles ────────────────────────────────────────
    const attachRegex = /\[ATTACH_PRODUCT:\s*(.*?)\]/gi;
    const mediaUrls: string[] = [];
    let match;
    while ((match = attachRegex.exec(rawAiResponse)) !== null) {
      const product = resolveProduct(match[1], allProducts);
      if (product) mediaUrls.push(...extractProductImageUrls(product));
    }

    // Handle [SEND_REVIEWS] — send review screenshots (NO extra text bubble needed)
    if (rawAiResponse.includes("[SEND_REVIEWS]") && reviewImageUrls.length > 0) {
      for (const imgUrl of reviewImageUrls.slice(0, 6)) {
        await sendWhatsAppImage(phoneId, token, fromCustomer, imgUrl);
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
      if (reviewsLink) {
        await sendWhatsAppText(phoneId, token, fromCustomer, `⭐ More reviews: ${reviewsLink}`);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    const wantsPhotos = userWantsProductPhotos(customerMessageText) || userConfirmedPhotoSend(customerMessageText);
    if (wantsPhotos && mediaUrls.length === 0 && allProducts?.length) {
      const discussed = inferDiscussedProduct(customerMessageText, validHistory, allProducts);
      if (discussed) {
        const urls = extractProductImageUrls(discussed);
        if (urls.length) mediaUrls.push(...urls);
      }
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

    if (mediaUrls.length > 0) {
      const finalUrls = mediaUrls.slice(0, 4);
      await Promise.all(finalUrls.map((url) => sendWhatsAppImage(phoneId, token, fromCustomer, url)));
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    if (cleanText) {
      const rawBubbles = cleanText.split("||").map((t) => t.trim()).filter((t) => t.length > 0);
      let lastWamid: string | null = null;
      for (const bubble of rawBubbles) {
        const wamid = await sendWhatsAppText(phoneId, token, fromCustomer, bubble);
        if (wamid) lastWamid = wamid;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      // Persist the wa_message_id so Meta's delivery/read callbacks can update ticks.
      if (lastWamid) {
        await supabaseAdmin
          .from("messages")
          .update({ wa_message_id: lastWamid })
          .eq("shop_id", business.id)
          .eq("phone_number", fromCustomer)
          .eq("role", "model")
          .eq("content", rawAiResponse)
          .is("wa_message_id", null)
          .order("created_at", { ascending: false })
          .limit(1);
      }
    }

    if (orderingEnabled && shouldScheduleCheckoutReminder(cleanText, rawAiResponse) && customer?.id) {
      const at = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      await supabaseAdmin
        .from("customers")
        .update({ checkout_reminder_at: at, checkout_reminder_sent: false })
        .eq("id", customer.id);
    }

    return new NextResponse("OK", { status: 200 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("❌ BOT WEBHOOK FATAL ERROR:", msg);
    return new NextResponse("Error", { status: 500 });
  }
}
