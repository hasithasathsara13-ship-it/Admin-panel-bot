import { NextRequest, NextResponse } from "next/server";
import {
  normalizeWhatsAppRecipientDigits,
  resolveWhatsappPhoneNumberId,
  resolveMetaApiToken,
} from "@/lib/whatsappMetaPhone";
import { supabaseAdminForWhatsApp } from "@/lib/whatsappMetaPhone";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Meta recommends max 80 messages/second for template messages
const DELAY_BETWEEN_MESSAGES_MS = 100;

/**
 * POST /api/broadcast
 * Body: {
 *   phone_numbers: string[],
 *   template_name: string,
 *   language?: string,
 *   custom_text?: string,     // For freeform text (only if within 24h window — rare for bulk)
 *   shop_id: string
 * }
 *
 * Returns: { ok, sent, failed, errors[] }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { phone_numbers, template_name, language, custom_text, header_image_url, shop_id } = body as {
      phone_numbers?: string[];
      template_name?: string;
      language?: string;
      custom_text?: string;
      header_image_url?: string;
      shop_id?: string;
    };

    if (!shop_id || typeof shop_id !== "string") {
      return NextResponse.json({ error: "Missing shop_id" }, { status: 400 });
    }

    if (!Array.isArray(phone_numbers) || phone_numbers.length === 0) {
      return NextResponse.json({ error: "No phone numbers provided" }, { status: 400 });
    }

    if (phone_numbers.length > 500) {
      return NextResponse.json(
        { error: "Maximum 500 recipients per broadcast" },
        { status: 400 },
      );
    }

    if (!template_name && !custom_text) {
      return NextResponse.json(
        { error: "Either template_name or custom_text is required" },
        { status: 400 },
      );
    }

    const token = await resolveMetaApiToken(shop_id);
    const phoneId = await resolveWhatsappPhoneNumberId(shop_id);

    if (!token || !phoneId) {
      return NextResponse.json(
        { error: "Business WhatsApp credentials not configured. Set them in Velo Admin." },
        { status: 500 },
      );
    }

    const metaUrl = `https://graph.facebook.com/v18.0/${phoneId}/messages`;
    const results: { phone: string; success: boolean; error?: string }[] = [];

    for (const rawPhone of phone_numbers) {
      const cleanPhone = normalizeWhatsAppRecipientDigits(rawPhone);
      if (!cleanPhone) {
        results.push({ phone: rawPhone, success: false, error: "Invalid number" });
        continue;
      }

      let payload: Record<string, unknown>;

      if (template_name) {
        // Template message (works outside 24h window)
        const templatePayload: Record<string, unknown> = {
          name: template_name,
          language: { code: language || "en" },
        };

        // Add image header component if provided
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

        payload = {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: cleanPhone,
          type: "template",
          template: templatePayload,
        };
      } else {
        // Freeform text (only works within 24h window)
        payload = {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: cleanPhone,
          type: "text",
          text: { preview_url: false, body: custom_text },
        };
      }

      try {
        const res = await fetch(metaUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          results.push({ phone: cleanPhone, success: true });
        } else {
          const errData = await res.json().catch(() => ({}));
          const errMsg =
            (errData as { error?: { message?: string } })?.error?.message ||
            `HTTP ${res.status}`;
          results.push({ phone: cleanPhone, success: false, error: errMsg });
        }
      } catch (err) {
        results.push({
          phone: cleanPhone,
          success: false,
          error: err instanceof Error ? err.message : "Network error",
        });
      }

      // Rate limiting delay
      if (phone_numbers.indexOf(rawPhone) < phone_numbers.length - 1) {
        await new Promise((r) => setTimeout(r, DELAY_BETWEEN_MESSAGES_MS));
      }
    }

    // Log broadcast to DB if admin client is available
    if (supabaseAdminForWhatsApp) {
      const sentCount = results.filter((r) => r.success).length;
      try {
        await supabaseAdminForWhatsApp.from("broadcast_logs").insert({
          shop_id,
          template_name: template_name || null,
          custom_text: custom_text || null,
          recipients_count: phone_numbers.length,
          sent_count: sentCount,
          failed_count: results.filter((r) => !r.success).length,
          created_at: new Date().toISOString(),
        });
      } catch {
        /* logging is best-effort */
      }
    }

    const sent = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return NextResponse.json({
      ok: true,
      sent,
      failed,
      total: phone_numbers.length,
      errors: results.filter((r) => !r.success),
    });
  } catch (err) {
    console.error("[broadcast] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * GET /api/broadcast?shop_id=...
 * Returns list of unique phone numbers from messages table for the shop.
 */
export async function GET(req: NextRequest) {
  const shopId = req.nextUrl.searchParams.get("shop_id");
  if (!shopId) {
    return NextResponse.json({ error: "Missing shop_id" }, { status: 400 });
  }

  const admin = supabaseAdminForWhatsApp;
  if (!admin) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  // Get unique phone numbers that have messaged this shop
  const { data: messages, error: msgErr } = await admin
    .from("messages")
    .select("phone_number, created_at")
    .eq("shop_id", shopId)
    .eq("role", "user")
    .order("created_at", { ascending: false });

  if (msgErr) {
    return NextResponse.json({ error: msgErr.message }, { status: 500 });
  }

  // Deduplicate and get last message time per phone
  const phoneMap = new Map<string, { phone: string; lastMessageAt: string; messageCount: number }>();
  for (const row of (messages ?? []) as { phone_number: string; created_at: string }[]) {
    const phone = row.phone_number;
    const existing = phoneMap.get(phone);
    if (!existing) {
      phoneMap.set(phone, { phone, lastMessageAt: row.created_at, messageCount: 1 });
    } else {
      existing.messageCount++;
    }
  }

  // Get customers with orders
  const { data: orders } = await admin
    .from("orders")
    .select("customer_phone, customer_name")
    .eq("shop_id", shopId);

  const nameMap = new Map<string, string>();
  for (const order of (orders ?? []) as { customer_phone?: string; customer_name?: string }[]) {
    const phone = order.customer_phone;
    const name = order.customer_name;
    if (phone && name && !nameMap.has(phone)) {
      nameMap.set(phone, name);
    }
  }

  const contacts = Array.from(phoneMap.values()).map((c) => ({
    ...c,
    name: nameMap.get(c.phone) || null,
  }));

  // Sort by last message time (most recent first)
  contacts.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());

  return NextResponse.json({ contacts });
}
