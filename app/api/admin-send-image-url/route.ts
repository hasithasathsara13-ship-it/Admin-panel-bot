import { NextRequest, NextResponse } from "next/server";
import {
  normalizeWhatsAppRecipientDigits,
  resolveWhatsappPhoneNumberId,
  resolveMetaApiToken,
} from "@/lib/whatsappMetaPhone";

/**
 * Send an image to a WhatsApp user by providing a public image URL.
 * Meta Cloud API will fetch the image from the URL directly.
 *
 * Body: { phone_number, image_url, caption?, shop_id? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { phone_number, image_url, caption, shop_id } = body as {
      phone_number?: string;
      image_url?: string;
      caption?: string;
      shop_id?: string;
    };

    if (!phone_number || typeof phone_number !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'phone_number'" },
        { status: 400 },
      );
    }
    if (!image_url || typeof image_url !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'image_url'" },
        { status: 400 },
      );
    }

    const shopIdClean = typeof shop_id === "string" && shop_id.trim() ? shop_id.trim() : undefined;
    if (!shopIdClean) {
      return NextResponse.json(
        { error: "Missing shop_id — required to resolve business WhatsApp credentials" },
        { status: 400 },
      );
    }
    const token = await resolveMetaApiToken(shopIdClean);
    const phoneId = await resolveWhatsappPhoneNumberId(shopIdClean);

    if (!token || !phoneId) {
      return NextResponse.json(
        { error: "Business WhatsApp credentials not configured. Set them in Velo Admin." },
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

    const metaUrl = `https://graph.facebook.com/v18.0/${phoneId}/messages`;

    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: cleanPhone,
      type: "image",
      image: {
        link: image_url,
        caption: caption || undefined,
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

    if (!metaRes.ok) {
      let errBody: unknown;
      const rawText = await metaRes.text();
      try {
        errBody = JSON.parse(rawText);
      } catch {
        errBody = rawText;
      }
      console.error(
        `[admin-send-image-url] Meta API error — HTTP ${metaRes.status}`,
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
    console.error("[admin-send-image-url] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
