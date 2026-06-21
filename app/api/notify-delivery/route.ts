export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from "next/server";
import {
  supabaseAdminForWhatsApp as supabaseAdmin,
  resolveBusinessForShop,
  whatsappPhoneNumberIdFromBusiness,
} from "@/lib/whatsappMetaPhone";

const META_TOKEN = process.env.META_API_TOKEN;

async function sendWhatsAppText(phoneId: string, to: string, text: string) {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v18.0/${phoneId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${META_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: text },
        }),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      console.error("❌ META API ERROR:", res.status, body);
      return false;
    }
    return true;
  } catch (error) {
    console.error("❌ META API ERROR:", error);
    return false;
  }
}

/**
 * POST /api/notify-delivery
 *
 * Body: { shop_id, customer_phone, product_name }
 *
 * Sends a WhatsApp delivery confirmation message to the customer.
 */
export async function POST(req: NextRequest) {
  try {
    if (!META_TOKEN || !supabaseAdmin) {
      return NextResponse.json(
        { error: "Server not configured for WhatsApp notifications." },
        { status: 500 },
      );
    }

    const body = await req.json();
    const { shop_id, order_id, customer_phone, product_name } = body ?? {};

    if (!shop_id || !customer_phone) {
      return NextResponse.json(
        { error: "Missing shop_id or customer_phone." },
        { status: 400 },
      );
    }

    // Resolve business from either businesses.id or shops.id mappings.
    let business = await resolveBusinessForShop(shop_id);

    // Fallback: if UI sent stale shop_id, recover via order_id -> orders.shop_id.
    if (!business && order_id) {
      const orderLookup = await supabaseAdmin
        .from("orders")
        .select("shop_id")
        .eq("id", order_id)
        .maybeSingle();

      const orderShopId =
        !orderLookup.error &&
        orderLookup.data &&
        typeof orderLookup.data.shop_id === "string"
          ? orderLookup.data.shop_id
          : null;

      if (orderShopId) {
        business = await resolveBusinessForShop(orderShopId);
      }
    }

    if (!business) {
      return NextResponse.json(
        { error: "Business not found." },
        { status: 404 },
      );
    }

    const phoneId = whatsappPhoneNumberIdFromBusiness(business);

    if (!phoneId) {
      return NextResponse.json(
        {
          error:
            "WhatsApp phone ID not configured. Add META_PHONE_NUMBER_ID (or META_PHONE_ID) to your .env.local or save meta_phone_id on the business row.",
        },
        { status: 500 },
      );
    }

    // Build the delivery message
    const storeName = business.business_name || "Our Store";
    const items = product_name || "your order";

    const message = [
      `✅ *Order Shipped!*`,
      ``,
      `Hi! Your order for *${items}* from *${storeName}* has been marked as Shipped.`,
      ``,
      `Thank you for shopping with us! If you have any questions, feel free to message us here. 😊`,
    ].join("\n");

    const sent = await sendWhatsAppText(phoneId, customer_phone, message);

    if (!sent) {
      return NextResponse.json(
        { error: "Failed to send WhatsApp message." },
        { status: 502 },
      );
    }

    // Log the outbound message in the messages table (same pattern as the bot)
    await supabaseAdmin.from("messages").insert([
      {
        phone_number: customer_phone,
        role: "model",
        content: message,
        shop_id,
      },
    ]);

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error("❌ notify-delivery error:", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    );
  }
}
