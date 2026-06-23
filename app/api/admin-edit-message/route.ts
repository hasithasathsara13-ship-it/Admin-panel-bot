import { NextRequest, NextResponse } from "next/server";
import {
  normalizeWhatsAppRecipientDigits,
  resolveWhatsappPhoneNumberId,
  resolveMetaApiToken,
} from "@/lib/whatsappMetaPhone";

/**
 * Edit an outbound text message on the customer's WhatsApp using the Cloud API.
 * Requires the Meta `wamid` stored on the message row (`wa_message_id`).
 *
 * Sends POST /{phone-number-id}/messages with `context.message_id` referencing the
 * outbound `wamid` to update (Meta: same messages endpoint as contextual replies;
 * text edits are subject to WhatsApp's short edit window).
 */
const GRAPH_VERSION = "v21.0";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { phone_number, shop_id, wa_message_id, message } = body as {
      phone_number?: string;
      shop_id?: string;
      wa_message_id?: string;
      message?: string;
    };

    if (!phone_number || typeof phone_number !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'phone_number'" },
        { status: 400 },
      );
    }
    if (!wa_message_id || typeof wa_message_id !== "string" || !wa_message_id.trim()) {
      return NextResponse.json(
        { error: "Missing or invalid 'wa_message_id' (WhatsApp message id)" },
        { status: 400 },
      );
    }
    if (!message || typeof message !== "string" || !message.trim()) {
      return NextResponse.json(
        { error: "Missing or invalid 'message'" },
        { status: 400 },
      );
    }

    const shopIdClean = typeof shop_id === "string" && shop_id.trim() ? shop_id.trim() : undefined;
    const token = await resolveMetaApiToken(shopIdClean);
    const phoneId = await resolveWhatsappPhoneNumberId(shopIdClean);

    if (!token || !phoneId) {
      console.error(
        "[admin-edit-message] Meta credentials not resolved for business",
      );
      return NextResponse.json(
        { error: "Business WhatsApp credentials not configured." },
        { status: 500 },
      );
    }

    const cleanPhone = normalizeWhatsAppRecipientDigits(phone_number);
    if (!cleanPhone) {
      return NextResponse.json(
        { error: "phone_number is empty after normalisation" },
        { status: 400 },
      );
    }

    const metaUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/messages`;

    const payload: Record<string, unknown> = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: cleanPhone,
      type: "text",
      text: {
        preview_url: false,
        body: message.trim(),
      },
      context: {
        message_id: wa_message_id.trim(),
      },
    };

    const metaRes = await fetch(metaUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const rawText = await metaRes.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText) as unknown;
    } catch {
      parsed = rawText;
    }

    if (!metaRes.ok) {
      console.error(
        `[admin-edit-message] Meta API error — HTTP ${metaRes.status}`,
        JSON.stringify(parsed, null, 2),
      );
      return NextResponse.json(
        { error: "Meta API request failed", details: parsed },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, data: parsed }, { status: 200 });
  } catch (err) {
    console.error("[admin-edit-message] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
