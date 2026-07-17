import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/admin-delete-message
 * Deletes a message from the dashboard inbox using the service role (bypasses RLS).
 * Body: { id, shop_id }
 */
export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  let body: { id?: string; shop_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const shopId = typeof body.shop_id === "string" ? body.shop_id.trim() : "";
  if (!id || !shopId) {
    return NextResponse.json({ error: "Missing id or shop_id" }, { status: 400 });
  }

  const admin = createClient(url, serviceKey);
  const { error } = await admin
    .from("messages")
    .delete()
    .eq("id", id)
    .eq("shop_id", shopId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
