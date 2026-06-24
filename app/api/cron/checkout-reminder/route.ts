export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function sendWhatsAppText(phoneId: string, token: string, to: string, text: string) {
  await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } }),
  });
}

function authorizeCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth === `Bearer ${secret}`) return true;
  if (process.env.VERCEL === "1" && req.headers.get("x-vercel-cron") === "1") return true;
  return process.env.NODE_ENV === "development" && req.nextUrl.searchParams.get("debug") === "1";
}

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const nowIso = new Date().toISOString();

  const { data: customers, error } = await supabaseAdmin
    .from("customers")
    .select("id, phone_number, shop_id, checkout_reminder_at")
    .eq("bot_active", true)
    .or("checkout_reminder_sent.eq.false,checkout_reminder_sent.is.null")
    .not("checkout_reminder_at", "is", null)
    .lte("checkout_reminder_at", nowIso);

  if (error) {
    console.error("checkout-reminder query:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  let sent = 0;
  for (const c of customers || []) {
    // Resolve per-business credentials
    const { data: biz } = await supabaseAdmin
      .from("businesses")
      .select("meta_phone_id, meta_phone_number_id, meta_api_token, bot_enabled")
      .eq("id", c.shop_id)
      .maybeSingle();

    const phoneId = biz?.meta_phone_id || biz?.meta_phone_number_id;
    const token = biz?.meta_api_token;
    if (!phoneId || !token || biz?.bot_enabled === false) {
      continue;
    }

    const text =
      "Hi again — just checking in. Are you still interested in finishing your order? Reply whenever you're ready, no rush.\n\n" +
      "Hi! Order eka complete karanna hithiyeda? Ready unama reply ekak dennako, rush ekak nehe 😊";

    try {
      await sendWhatsAppText(phoneId, token, c.phone_number, text);
      await supabaseAdmin.from("customers").update({ checkout_reminder_sent: true }).eq("id", c.id);
      await supabaseAdmin.from("messages").insert([
        {
          phone_number: c.phone_number,
          role: "model",
          content: `[checkout reminder] ${text}`,
          shop_id: c.shop_id,
        },
      ]);
      sent++;
    } catch (e) {
      console.error("checkout-reminder send failed", c.id, e);
    }
  }

  return NextResponse.json({ ok: true, due: customers?.length ?? 0, sent });
}
