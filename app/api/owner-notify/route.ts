import { NextRequest, NextResponse } from "next/server";
import {
  resolveBusinessForShop,
  supabaseAdminForWhatsApp as supabaseAdmin,
  whatsappPhoneNumberIdFromBusiness,
} from "@/lib/whatsappMetaPhone";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const META_TOKEN = process.env.META_API_TOKEN;

type NotifyType = "order_created" | "human_handoff" | "billing_courtesy_buffer";

function normalizePhone(phone: string): string {
  return phone.replace(/[+\s\-().]/g, "");
}

async function sendWhatsAppText(phoneId: string, to: string, text: string) {
  const res = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${META_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body: text },
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[owner-notify] Meta API error:", res.status, body);
    return false;
  }
  return true;
}

function mustBeInternal(req: NextRequest): boolean {
  const expected = process.env.INTERNAL_WEBHOOK_SECRET?.trim();
  if (!expected) return false;
  const got = req.headers.get("x-internal-secret")?.trim();
  return !!got && got === expected;
}

export async function POST(req: NextRequest) {
  try {
    if (!mustBeInternal(req)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!META_TOKEN || !supabaseAdmin) {
      return NextResponse.json(
        { error: "Server not configured" },
        { status: 500 },
      );
    }

    const body = (await req.json()) as {
      type?: NotifyType;
      shop_id?: string;
      courtesy_text?: string;
      order?: {
        id?: string;
        customer_phone?: string;
        product_name?: string;
        total_price?: number | string;
        payment_method?: string | null;
        delivery_address?: string | null;
        status?: string | null;
      };
      message?: {
        id?: string;
        phone_number?: string;
        content?: string;
      };
    };

    const shopId = typeof body.shop_id === "string" ? body.shop_id.trim() : "";
    const type = body.type;
    if (
      !shopId ||
      (type !== "order_created" &&
        type !== "human_handoff" &&
        type !== "billing_courtesy_buffer")
    ) {
      return NextResponse.json({ error: "Bad request" }, { status: 400 });
    }

    const business = await resolveBusinessForShop(shopId);
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 });
    }

    const ownerPhoneRaw = business.whatsapp_number;
    const ownerPhone = ownerPhoneRaw ? normalizePhone(ownerPhoneRaw) : "";
    if (!ownerPhone) {
      return NextResponse.json(
        { error: "Owner WhatsApp number not configured on business" },
        { status: 500 },
      );
    }

    const phoneId = whatsappPhoneNumberIdFromBusiness(business);
    if (!phoneId) {
      return NextResponse.json(
        { error: "Meta phone_number_id not configured" },
        { status: 500 },
      );
    }

    const storeName = business.business_name || "Your Store";

    let messageText = "";
    if (type === "order_created") {
      const o = body.order ?? {};
      const customer = (o.customer_phone ?? "").toString();
      const product = (o.product_name ?? "Order").toString();
      const price = o.total_price != null ? String(o.total_price) : "";
      const pay = o.payment_method ? String(o.payment_method) : "";
      const addr = o.delivery_address ? String(o.delivery_address) : "";
      messageText = [
        `🛒 *New Order* (${storeName})`,
        o.id ? `Order ID: ${o.id}` : "",
        customer ? `Customer: ${customer}` : "",
        product ? `Item: ${product}` : "",
        price ? `Total: ${price}` : "",
        pay ? `Payment: ${pay}` : "",
        addr ? `Address: ${addr}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    } else if (type === "human_handoff") {
      const m = body.message ?? {};
      const from = (m.phone_number ?? "").toString();
      messageText = [
        `🧑‍💼 *Human help needed* (${storeName})`,
        from ? `Customer: ${from}` : "",
        `The bot asked to transfer to a representative.`,
        `Open the dashboard → Messages to reply.`,
      ]
        .filter(Boolean)
        .join("\n");
    } else {
      const t = typeof body.courtesy_text === "string" ? body.courtesy_text.trim() : "";
      if (!t) {
        return NextResponse.json({ error: "courtesy_text required" }, { status: 400 });
      }
      messageText = t;
    }

    const ok = await sendWhatsAppText(phoneId, ownerPhone, messageText);
    if (!ok) {
      return NextResponse.json({ error: "Failed to send WhatsApp" }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[owner-notify] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

