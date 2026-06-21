import { NextRequest, NextResponse } from "next/server";
import {
  normalizeWhatsAppRecipientDigits,
  resolveWhatsappPhoneNumberId,
} from "@/lib/whatsappMetaPhone";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { phone_number, template_name, language, shop_id } = body as {
      phone_number?: string;
      template_name?: string;
      language?: string;
      shop_id?: string;
    };

    // ── Validate input ────────────────────────────────────────────────────────
    if (!phone_number || typeof phone_number !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'phone_number'" },
        { status: 400 }
      );
    }
    if (!template_name || typeof template_name !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'template_name'" },
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
        "[admin-send-template] META_API_TOKEN missing or WhatsApp phone ID not resolved",
      );
      return NextResponse.json(
        { error: "Server misconfiguration: missing Meta credentials" },
        { status: 500 }
      );
    }

    // ── Normalise recipient number ─────────────────────────────────────────────
    const cleanPhone = normalizeWhatsAppRecipientDigits(phone_number);
    if (!cleanPhone) {
      return NextResponse.json(
        { error: "phone_number is empty after normalisation" },
        { status: 400 }
      );
    }

    console.log(
      `[admin-send-template] Sending template "${template_name}" to ${cleanPhone}`,
    );

    // ── Build Meta Cloud API template request ─────────────────────────────────
    const metaUrl = `https://graph.facebook.com/v18.0/${phoneId}/messages`;

    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: cleanPhone,
      type: "template",
      template: {
        name: template_name,
        language: {
          code: language || "en",
        },
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
      let errBody: unknown;
      const rawText = await metaRes.text();
      try {
        errBody = JSON.parse(rawText);
      } catch {
        errBody = rawText;
      }
      console.error(
        `[admin-send-template] Meta API error — HTTP ${metaRes.status}`,
        JSON.stringify(errBody, null, 2),
      );
      return NextResponse.json(
        { error: "Meta API request failed", details: errBody },
        { status: 500 },
      );
    }

    const data = await metaRes.json();
    return NextResponse.json({ ok: true, data }, { status: 200 });
  } catch (err) {
    console.error("[admin-send-template] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
