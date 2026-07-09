import { NextRequest, NextResponse } from "next/server";
import {
  normalizeWhatsAppRecipientDigits,
  resolveWhatsappPhoneNumberId,
  resolveMetaApiToken,
} from "@/lib/whatsappMetaPhone";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { phone_number, template_name, language, header_image_url, shop_id } = body as {
      phone_number?: string;
      template_name?: string;
      language?: string;
      header_image_url?: string;
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

    // ── Resolve per-business credentials from database ─────────────────────────
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
        "[admin-send-template] Meta credentials not found for business",
      );
      return NextResponse.json(
        { error: "Business WhatsApp credentials not configured. Set them in Velo Admin." },
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

    // ── Template quota check ──────────────────────────────────────────────────
    try {
      const { getPlanFreeTemplates } = await import("@/lib/plansDb");
      const { createClient } = await import("@supabase/supabase-js");
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (supabaseUrl && serviceKey) {
        const admin = createClient(supabaseUrl, serviceKey);
        const { data: biz } = await admin
          .from("businesses")
          .select("billing_plan, billing_templates_used_period")
          .eq("id", shopIdClean)
          .maybeSingle();
        if (biz) {
          const plan = (biz as Record<string, unknown>).billing_plan as string ?? "Starter";
          const templatesUsed = Number((biz as Record<string, unknown>).billing_templates_used_period ?? 0);
          const freeTemplates = await getPlanFreeTemplates(plan);
          if (templatesUsed >= freeTemplates) {
            return NextResponse.json(
              { error: `Template quota exceeded. Your ${plan} plan includes ${freeTemplates} free templates/month. Used: ${templatesUsed}. Upgrade your plan for more.` },
              { status: 429 }
            );
          }
          // Increment template usage
          await admin
            .from("businesses")
            .update({ billing_templates_used_period: templatesUsed + 1 })
            .eq("id", shopIdClean);
        }
      }
    } catch (quotaErr) {
      console.warn("[admin-send-template] Template quota check failed (non-blocking):", quotaErr);
    }

    console.log(
      `[admin-send-template] Sending template "${template_name}" to ${cleanPhone}`,
    );

    // ── Build Meta Cloud API template request ─────────────────────────────────
    const metaUrl = `https://graph.facebook.com/v18.0/${phoneId}/messages`;

    const templatePayload: Record<string, unknown> = {
      name: template_name,
      language: {
        code: language || "en",
      },
    };

    if (header_image_url) {
      templatePayload.components = [
        {
          type: "header",
          parameters: [
            {
              type: "image",
              image: { link: header_image_url },
            },
          ],
        },
      ];
    }

    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: cleanPhone,
      type: "template",
      template: templatePayload,
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
