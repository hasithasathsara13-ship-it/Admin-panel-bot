import { NextRequest, NextResponse } from "next/server";
import {
  normalizeWhatsAppRecipientDigits,
  resolveWhatsappPhoneNumberId,
  resolveMetaApiToken,
  supabaseAdminForWhatsApp as supabaseAdmin,
} from "@/lib/whatsappMetaPhone";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { phone_number, message, shop_id, message_row_id } = body as {
      phone_number?: string;
      message?: string;
      shop_id?: string;
      message_row_id?: string;
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

    // ── Resolve per-business Meta credentials from database ───────────────────
    const shopIdClean = typeof shop_id === "string" && shop_id.trim() ? shop_id.trim() : undefined;
    if (!shopIdClean) {
      return NextResponse.json(
        { error: "Missing shop_id — required to resolve business WhatsApp credentials" },
        { status: 400 }
      );
    }
    const token = await resolveMetaApiToken(shopIdClean);
    const phoneId = await resolveWhatsappPhoneNumberId(shopIdClean);

    if (!token || !phoneId) {
      console.error(
        `[admin-send] Credentials not resolved for shop_id=${shopIdClean}. token=${token ? "set" : "MISSING"}, phoneId=${phoneId || "MISSING"}. Ensure meta_api_token and meta_phone_id are set in the businesses table.`,
      );
      return NextResponse.json(
        { error: `WhatsApp credentials not configured for this business. token=${token ? "✓" : "✗"} phoneId=${phoneId ? "✓" : "✗"}. Go to Velo Admin → Businesses → set Meta API Token and Phone Number ID.` },
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
