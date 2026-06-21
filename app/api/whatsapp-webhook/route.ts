import crypto from "crypto";

import { NextRequest, NextResponse } from "next/server";

import { courtesyOwnerMessage } from "@/lib/billing";

import { supabaseAdminForWhatsApp } from "@/lib/whatsappMetaPhone";

import {

  formatInboundWaMediaContent,

  mediaIdFromWhatsAppAttachment,

  parseWhatsAppMediaContent,

} from "@/lib/whatsappMediaContent";

import {
  deleteRecentVoiceTranscripts,
  forwardWebhookToBot,
  upgradeRecentVoiceTranscript,
} from "@/lib/whatsappWebhookInbound";



export const dynamic = "force-dynamic";

export const runtime = "nodejs";



/**

 * WhatsApp Cloud API webhook — verifies with Meta, stores inbound messages in

 * `public.messages` using `wa-media:<id>:image|audio` so the dashboard proxy works.

 *

 * Env:

 *   META_WEBHOOK_VERIFY_TOKEN (or WHATSAPP_VERIFY_TOKEN) — must match Meta callback verify token

 *   META_APP_SECRET — optional; if set, validates X-Hub-Signature-256

 *   WHATSAPP_WEBHOOK_DEFAULT_SHOP_ID — optional UUID when `businesses.meta_phone_id` is not set

 *   META_PHONE_NUMBER_ID / META_PHONE_ID — used with default shop when phone_number_id matches

 *   INTERNAL_WEBHOOK_SECRET + NEXT_PUBLIC_APP_URL (or VERCEL_URL) — courtesy WhatsApp to owner at 100% plan usage

 *

 * Meta callback URL: https://<your-domain>/api/whatsapp-webhook

 */



function verifyMetaSignature(rawBody: string, signature: string | null): boolean {

  const secret = process.env.META_APP_SECRET?.trim();

  if (!secret) return true;

  if (!signature?.startsWith("sha256=")) return false;

  const expected = crypto

    .createHmac("sha256", secret)

    .update(rawBody)

    .digest("hex");

  const theirs = signature.slice(7);

  try {

    return crypto.timingSafeEqual(

      Buffer.from(theirs, "hex"),

      Buffer.from(expected, "hex"),

    );

  } catch {

    return false;

  }

}



function normalizeCustomerPhone(from: string): string {

  return from.replace(/[^\d]/g, "");

}



async function resolveShopId(

  phoneNumberId: string | undefined,

): Promise<string | null> {

  const admin = supabaseAdminForWhatsApp;

  if (!admin) {

    console.error("[whatsapp-webhook] SUPABASE_SERVICE_ROLE_KEY / URL not configured");

    return null;

  }



  const pid = phoneNumberId?.trim();

  if (!pid) return null;



  const { data: byMeta } = await admin

    .from("businesses")

    .select("id")

    .eq("meta_phone_id", pid)

    .maybeSingle();



  if (byMeta && typeof (byMeta as { id?: string }).id === "string") {

    return (byMeta as { id: string }).id;

  }



  const envPhone =

    process.env.META_PHONE_NUMBER_ID?.trim() ||

    process.env.META_PHONE_ID?.trim();



  const defaultShop = process.env.WHATSAPP_WEBHOOK_DEFAULT_SHOP_ID?.trim();



  if (envPhone && pid === envPhone && defaultShop) return defaultShop;



  if (envPhone && pid === envPhone) {

    const { data: one } = await admin

      .from("businesses")

      .select("id")

      .limit(1)

      .maybeSingle();

    if (one && typeof (one as { id?: string }).id === "string") {

      return (one as { id: string }).id;

    }

  }



  return defaultShop ?? null;

}



function contentFromInboundMessage(msg: Record<string, unknown>): string | null {

  const type = String(msg.type ?? "").toLowerCase();



  if (type === "text") {

    const body = (msg.text as { body?: string } | undefined)?.body?.trim();

    return body || null;

  }



  if (type === "image") {

    const im = msg.image;

    const mediaId = mediaIdFromWhatsAppAttachment(im);

    if (!mediaId) return null;

    const caption = (im as { caption?: string } | undefined)?.caption;

    return formatInboundWaMediaContent(mediaId, "image", caption);

  }



  if (type === "sticker") {

    const mediaId = mediaIdFromWhatsAppAttachment(msg.sticker);

    if (!mediaId) return null;

    return formatInboundWaMediaContent(mediaId, "sticker", null);

  }



  if (type === "audio" || type === "voice") {

    const attachment = msg.audio ?? msg.voice;

    const mediaId = mediaIdFromWhatsAppAttachment(attachment);

    if (!mediaId) {

      console.warn("[whatsapp-webhook] audio/voice without media id:", {

        type,

        attachment,

      });

      return null;

    }

    return formatInboundWaMediaContent(mediaId, "audio", null);

  }



  if (type === "video") {

    const v = msg.video;

    const mediaId = mediaIdFromWhatsAppAttachment(v);

    if (!mediaId) return null;

    const caption = (v as { caption?: string } | undefined)?.caption;

    return formatInboundWaMediaContent(mediaId, "video", caption);

  }



  if (type === "document") {

    const d = msg.document;

    const mediaId = mediaIdFromWhatsAppAttachment(d);

    if (!mediaId) return null;

    const caption = (d as { caption?: string } | undefined)?.caption;

    return formatInboundWaMediaContent(mediaId, "document", caption);

  }



  if (type === "button") {

    const b = msg.button as { text?: string } | undefined;

    const t = b?.text?.trim();

    return t || null;

  }



  if (type === "interactive") {

    const ir = msg.interactive as Record<string, unknown> | undefined;

    const br = ir?.button_reply as { title?: string } | undefined;

    const lr = ir?.list_reply as { title?: string } | undefined;

    const t = (br?.title ?? lr?.title)?.trim();

    return t || null;

  }



  if (type === "location") {

    const loc = msg.location as {

      latitude?: number;

      longitude?: number;

      name?: string;

    } | undefined;

    if (loc?.latitude != null && loc?.longitude != null) {

      const name = loc.name?.trim();

      return name

        ? `📍 ${name}\n${loc.latitude}, ${loc.longitude}`

        : `📍 ${loc.latitude}, ${loc.longitude}`;

    }

  }



  if (type === "contacts" || type === "system" || type === "reaction") {

    return null;

  }



  // Meta voice notes are usually type "audio" with msg.audio.voice === true; catch odd payloads.

  const audioId = mediaIdFromWhatsAppAttachment(msg.audio ?? msg.voice);

  if (audioId) {

    return formatInboundWaMediaContent(audioId, "audio", null);

  }



  return `[${type || "unknown"} message]`;

}



export async function GET(req: NextRequest) {

  const mode = req.nextUrl.searchParams.get("hub.mode");

  const token = req.nextUrl.searchParams.get("hub.verify_token");

  const challenge = req.nextUrl.searchParams.get("hub.challenge");



  const verify =

    process.env.META_WEBHOOK_VERIFY_TOKEN?.trim() ||

    process.env.WHATSAPP_VERIFY_TOKEN?.trim();



  if (mode === "subscribe" && token && verify && token === verify && challenge) {

    return new NextResponse(challenge, {

      status: 200,

      headers: { "Content-Type": "text/plain" },

    });

  }



  return new NextResponse("Forbidden", { status: 403 });

}



export async function POST(req: NextRequest) {

  const rawBody = await req.text();



  if (!verifyMetaSignature(rawBody, req.headers.get("x-hub-signature-256"))) {

    return new NextResponse("Invalid signature", { status: 401 });

  }



  let body: unknown;

  try {

    body = JSON.parse(rawBody) as unknown;

  } catch {

    return new NextResponse("Bad JSON", { status: 400 });

  }



  const admin = supabaseAdminForWhatsApp;

  if (!admin) {

    console.error("[whatsapp-webhook] Supabase admin client unavailable");

    return NextResponse.json({ ok: false }, { status: 500 });

  }



  const root = body as {

    object?: string;

    entry?: Array<{

      changes?: Array<{

        field?: string;

        value?: Record<string, unknown>;

      }>;

    }>;

  };



  if (root.object !== "whatsapp_business_account") {

    return NextResponse.json({ ok: true });

  }

  await forwardWebhookToBot(rawBody, req.headers.get("x-hub-signature-256"));



  for (const entry of root.entry ?? []) {

    for (const change of entry.changes ?? []) {

      if (change.field !== "messages") continue;

      const value = change.value;

      if (!value || typeof value !== "object") continue;



      const metadata = value.metadata as { phone_number_id?: string } | undefined;

      const phoneNumberId = metadata?.phone_number_id;



      const shopId = await resolveShopId(phoneNumberId);

      if (!shopId) {

        console.warn(

          "[whatsapp-webhook] No shop_id for phone_number_id:",

          phoneNumberId,

          "— set businesses.meta_phone_id or WHATSAPP_WEBHOOK_DEFAULT_SHOP_ID",

        );

        continue;

      }



      const messages = value.messages as Record<string, unknown>[] | undefined;

      if (!Array.isArray(messages)) continue;



      for (const msg of messages) {

        const fromRaw = String(msg.from ?? "");

        const from = normalizeCustomerPhone(fromRaw);

        if (!from) continue;



        const content = contentFromInboundMessage(msg);

        if (!content) continue;



        const waMessageId =

          typeof msg.id === "string" && msg.id.trim() ? msg.id.trim() : null;



        if (waMessageId) {

          const { data: existing } = await admin

            .from("messages")

            .select("id, content")

            .eq("shop_id", shopId)

            .eq("wa_message_id", waMessageId)

            .maybeSingle();

          if (existing) {

            const ex = existing as { id: string; content?: string };

            const prev = parseWhatsAppMediaContent(String(ex.content ?? ""));

            const incomingIsPlayableMedia = content.trim().startsWith("wa-media:");

            if (prev.kind === "bot_transcription" && incomingIsPlayableMedia) {

              const { error: upErr } = await admin

                .from("messages")

                .update({ content })

                .eq("id", ex.id);

              if (upErr) {

                console.error("[whatsapp-webhook] upgrade transcript error:", upErr);

              }

            }

            continue;

          }

        }

        if (

          await upgradeRecentVoiceTranscript(

            admin,

            shopId,

            from,

            content,

            waMessageId,

          )

        ) {

          continue;

        }



        const row: Record<string, unknown> = {

          shop_id: shopId,

          phone_number: from,

          role: "user",

          content,

        };

        if (waMessageId) row.wa_message_id = waMessageId;



        const { error } = await admin.from("messages").insert(row);



        if (error) {

          console.error("[whatsapp-webhook] insert error:", error);

          continue;

        }

        if (content.includes("wa-media:") && content.includes(":audio")) {

          await deleteRecentVoiceTranscripts(admin, shopId, from);

        }



        const { data: usageRaw, error: usageErr } = await admin.rpc(

          "increment_shop_billing_usage",

          { p_shop_id: shopId },

        );



        if (usageErr) {

          console.warn("[whatsapp-webhook] billing usage rpc:", usageErr.message);

          continue;

        }



        const usage = usageRaw as {

          ok?: boolean;

          send_courtesy_whatsapp?: boolean;

          included?: number;

          buffer_extra?: number;

          hard_cap?: number;

        } | null;



        if (usage?.ok && usage.send_courtesy_whatsapp) {

          const internal = process.env.INTERNAL_WEBHOOK_SECRET?.trim();

          const origin =

            process.env.NEXT_PUBLIC_APP_URL?.trim() ||

            (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||

            "";

          if (internal && origin) {

            const { data: biz } = await admin

              .from("businesses")

              .select("business_name")

              .eq("id", shopId)

              .maybeSingle();

            const storeName =

              (biz as { business_name?: string } | null)?.business_name?.trim() || "Your Store";

            const courtesyText = courtesyOwnerMessage({

              storeName,

              included: Number(usage.included ?? 0),

              bufferExtra: Number(usage.buffer_extra ?? 0),

              hardCap: Number(usage.hard_cap ?? 0),

            });

            try {

              await fetch(`${origin.replace(/\/$/, "")}/api/owner-notify`, {

                method: "POST",

                headers: {

                  "Content-Type": "application/json",

                  "x-internal-secret": internal,

                },

                body: JSON.stringify({

                  type: "billing_courtesy_buffer",

                  shop_id: shopId,

                  courtesy_text: courtesyText,

                }),

              });

            } catch (e) {

              console.warn("[whatsapp-webhook] courtesy notify failed:", e);

            }

          }

        }

      }

    }

  }



  return NextResponse.json({ ok: true });

}


