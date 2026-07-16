import { NextRequest, NextResponse } from "next/server";
import { supabaseAdminForWhatsApp as supabaseAdmin } from "@/lib/whatsappMetaPhone";
import { ensureVapidConfigured, sendPushToShop } from "@/lib/webPush";

export const runtime = "nodejs";

// Diagnostic: send a test push to every device registered for a shop.
// Returns detailed info so the admin can see exactly what's configured.
export async function POST(req: NextRequest) {
  const vapidOk = ensureVapidConfigured();

  if (!supabaseAdmin) {
    return NextResponse.json(
      { ok: false, vapidConfigured: vapidOk, error: "Supabase admin not configured on server" },
      { status: 500 },
    );
  }

  let body: { shopId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const shopId = body.shopId?.trim();
  if (!shopId) {
    return NextResponse.json({ ok: false, error: "Missing shopId" }, { status: 400 });
  }

  // How many devices are registered for this shop?
  const { data, error } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id")
    .eq("shop_id", shopId);

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        vapidConfigured: vapidOk,
        error: `DB error: ${error.message}. Did you run push_subscriptions.sql?`,
      },
      { status: 500 },
    );
  }

  const deviceCount = data?.length ?? 0;

  if (!vapidOk) {
    return NextResponse.json({
      ok: false,
      vapidConfigured: false,
      deviceCount,
      error: "VAPID keys missing on server. Add NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT to Vercel and redeploy.",
    });
  }

  if (deviceCount === 0) {
    return NextResponse.json({
      ok: false,
      vapidConfigured: true,
      deviceCount: 0,
      error: "No devices registered. Enable notifications inside the installed app on this phone first.",
    });
  }

  await sendPushToShop(shopId, {
    title: "Velo.ai test 🔔",
    body: "If you see this on your lock screen, push notifications are working!",
    url: "/dashboard",
    tag: "test-push",
  });

  return NextResponse.json({ ok: true, vapidConfigured: true, deviceCount });
}
