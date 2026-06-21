import { NextRequest, NextResponse } from "next/server";

import { supabaseAdminForWhatsApp } from "@/lib/whatsappMetaPhone";
import {
  formatInboundWaMediaContent,
  parseWhatsAppMediaContent,
} from "@/lib/whatsappMediaContent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/ingest-inbound
 *
 * For your WhatsApp bot (when Meta webhook still points at the bot server).
 * Saves customer messages into `public.messages` with playable media refs.
 *
 * Header: `x-internal-secret` must match INTERNAL_WEBHOOK_SECRET
 *
 * Body:
 *   shop_id (uuid, required)
 *   phone_number (digits, required)
 *   wa_message_id (optional, recommended — dedup + upgrade bad transcripts)
 *   type: "text" | "audio" | "image" | "video" | "document" | "sticker"
 *   text (for type text)
 *   media_id (for audio/image/… — required for voice playback)
 *   caption (optional, images/video)
 */
export async function POST(req: NextRequest) {
  const secret = process.env.INTERNAL_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "INTERNAL_WEBHOOK_SECRET not configured" },
      { status: 500 },
    );
  }
  if (req.headers.get("x-internal-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdminForWhatsApp;
  if (!admin) {
    return NextResponse.json({ error: "Supabase admin unavailable" }, { status: 500 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const shopId = typeof body.shop_id === "string" ? body.shop_id.trim() : "";
  const phoneRaw = typeof body.phone_number === "string" ? body.phone_number : "";
  const phone = phoneRaw.replace(/[^\d]/g, "");
  const waMessageId =
    typeof body.wa_message_id === "string" && body.wa_message_id.trim()
      ? body.wa_message_id.trim()
      : null;
  const type = String(body.type ?? "text").toLowerCase();

  if (!shopId || !phone) {
    return NextResponse.json(
      { error: "shop_id and phone_number are required" },
      { status: 400 },
    );
  }

  let content: string | null = null;

  if (type === "text") {
    const t = typeof body.text === "string" ? body.text.trim() : "";
    content = t || null;
  } else if (type === "audio" || type === "voice") {
    const mediaId =
      typeof body.media_id === "string" ? body.media_id.trim() : "";
    if (!mediaId) {
      return NextResponse.json(
        {
          error:
            "media_id is required for audio — do not save [Voice Note]: transcriptions",
        },
        { status: 400 },
      );
    }
    content = formatInboundWaMediaContent(mediaId, "audio", null);
  } else if (type === "image" || type === "sticker") {
    const mediaId =
      typeof body.media_id === "string" ? body.media_id.trim() : "";
    if (!mediaId) {
      return NextResponse.json({ error: "media_id is required" }, { status: 400 });
    }
    const caption =
      typeof body.caption === "string" ? body.caption : null;
    content = formatInboundWaMediaContent(
      mediaId,
      type === "sticker" ? "sticker" : "image",
      caption,
    );
  } else if (
    type === "video" ||
    type === "document"
  ) {
    const mediaId =
      typeof body.media_id === "string" ? body.media_id.trim() : "";
    if (!mediaId) {
      return NextResponse.json({ error: "media_id is required" }, { status: 400 });
    }
    const caption =
      typeof body.caption === "string" ? body.caption : null;
    content = formatInboundWaMediaContent(mediaId, type, caption);
  } else {
    return NextResponse.json({ error: `Unsupported type: ${type}` }, { status: 400 });
  }

  if (!content) {
    return NextResponse.json({ error: "Empty message content" }, { status: 400 });
  }

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
      const incomingIsPlayableMedia = content.startsWith("wa-media:");
      if (prev.kind === "bot_transcription" && incomingIsPlayableMedia) {
        const { error: upErr } = await admin
          .from("messages")
          .update({ content })
          .eq("id", ex.id);
        if (upErr) {
          return NextResponse.json({ error: upErr.message }, { status: 500 });
        }
        return NextResponse.json({ ok: true, upgraded: true });
      }
      return NextResponse.json({ ok: true, duplicate: true });
    }
  }

  const row: Record<string, unknown> = {
    shop_id: shopId,
    phone_number: phone,
    role: "user",
    content,
  };
  if (waMessageId) row.wa_message_id = waMessageId;

  const { error } = await admin.from("messages").insert(row);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
