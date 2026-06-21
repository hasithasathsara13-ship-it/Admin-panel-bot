import { NextRequest, NextResponse } from "next/server";
import {
  normalizeWhatsAppRecipientDigits,
  resolveWhatsappPhoneNumberId,
} from "@/lib/whatsappMetaPhone";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { phone_number, message, shop_id } = body as {
      phone_number?: string;
      message?: string;
      shop_id?: string;
    };

    // ── Validate input ────────────────────────────────────────────────────────
    if (!phone_number || typeof phone_number !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'phone_number'" },
        { status: 400 }
      );
    }
    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'message'" },
        { status: 400 }
      );
    }

    // ── Env vars ──────────────────────────────────────────────────────────────
    const token = process.env.META_API_TOKEN;
    const phoneId = await resolveWhatsappPhoneNumberId(
      typeof shop_id === "string" && shop_id.trim() ? shop_id.trim() : undefined,
    );

    if (!token || !phoneId) {
      console.error(
        "[admin-send] META_API_TOKEN missing or WhatsApp phone ID not resolved (set META_PHONE_NUMBER_ID / META_PHONE_ID, or shop meta_phone_id)",
      );
      return NextResponse.json(
        { error: "Server misconfiguration: missing Meta credentials" },
        { status: 500 }
      );
    }

    // ── Normalise recipient number ─────────────────────────────────────────────
    // Meta requires the number to have the country code with NO leading +, spaces,
    // dashes, or parentheses. e.g. "+94 77 123 4567" → "94771234567"
    const cleanPhone = normalizeWhatsAppRecipientDigits(phone_number);
    if (!cleanPhone) {
      return NextResponse.json(
        { error: "phone_number is empty after normalisation" },
        { status: 400 }
      );
    }

    console.log(`[admin-send] Sending to normalised number: ${cleanPhone}`);

    // ── Build Meta Cloud API request ──────────────────────────────────────────
    const metaUrl = `https://graph.facebook.com/v18.0/${phoneId}/messages`;

    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: cleanPhone,
      type: "text",
      text: {
        preview_url: false,
        body: message,
      },
    };

    // ── Send ──────────────────────────────────────────────────────────────────
    const metaRes = await fetch(metaUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!metaRes.ok) {
      // Parse as JSON first for the full structured error (code, error_data, etc.),
      // fall back to raw text so we never swallow the body.
      let errBody: unknown;
      const rawText = await metaRes.text();
      try {
        errBody = JSON.parse(rawText);
      } catch {
        errBody = rawText;
      }
      console.error(
        `[admin-send] Meta API error — HTTP ${metaRes.status}`,
        JSON.stringify(errBody, null, 2)
      );
      return NextResponse.json(
        { error: "Meta API request failed", details: errBody },
        { status: 500 }
      );
    }

    const data = await metaRes.json();
    return NextResponse.json({ ok: true, data }, { status: 200 });
  } catch (err) {
    console.error("[admin-send] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
