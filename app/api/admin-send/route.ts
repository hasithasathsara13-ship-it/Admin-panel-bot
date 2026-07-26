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

    // ── Check connection mode — route to Baileys bridge for WhatsApp Web businesses
    if (supabaseAdmin) {
      const { data: bizRow, error: bizErr } = await supabaseAdmin
        .from("businesses")
        .select("connection_mode")
        .eq("id", shopIdClean)
        .maybeSingle();
      
      // If the column doesn't exist, bizErr will be set — ignore and fall through to Meta API
      const mode = bizErr ? null : (bizRow as { connection_mode?: string } | null)?.connection_mode;
      console.log(`[admin-send] shop=${shopIdClean} connection_mode=${mode} bizErr=${bizErr?.message ?? "none"}`);
      if (mode === "whatsapp_web") {
        // Route through Baileys bridge server
        const bridgeUrl = process.env.BAILEYS_BRIDGE_URL || "http://localhost:3001";
        const bridgeSecret = process.env.BAILEYS_BRIDGE_SECRET || "";
        try {
          // Strip @lid or other WhatsApp internal suffixes — bridge needs plain digits
          const cleanPhoneForBridge = String(phone_number).replace(/@.*/g, "").replace(/[^\d]/g, "");
          const bridgeRes = await fetch(`${bridgeUrl}/message/send-text`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-bridge-secret": bridgeSecret,
            },
            body: JSON.stringify({ shop_id: shopIdClean, phone_number: cleanPhoneForBridge, message }),
          });
          const bridgeData = await bridgeRes.json().catch(() => ({}));
          console.log(`[admin-send] Bridge response: status=${bridgeRes.status} data=${JSON.stringify(bridgeData)} phone=${cleanPhoneForBridge}`);
          if (!bridgeRes.ok) {
            return NextResponse.json(
              { error: bridgeData.error || "Bridge send failed" },
              { status: bridgeRes.status },
            );
          }
          return NextResponse.json({
            ok: true,
            messages: [{ id: bridgeData.wa_message_id ?? null }],
          });
        } catch (e) {
          return NextResponse.json(
            { error: "Bridge server unavailable" },
            { status: 503 },
          );
        }
      }
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
