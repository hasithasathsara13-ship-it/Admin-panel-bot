import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/admin-update-message
 * Updates a message's content in the dashboard inbox using the service role (bypasses RLS).
 * Body: { id, shop_id, content }
 */
export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  let body: { id?: string; shop_id?: string; content?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const shopId = typeof body.shop_id === "string" ? body.shop_id.trim() : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!id || !shopId || !content) {
    return NextResponse.json({ error: "Missing id, shop_id or content" }, { status: 400 });
  }

  const admin = createClient(url, serviceKey);
  const editedAt = new Date().toISOString();

  // Try with edited_at column first, fall back if column doesn't exist
  let { error } = await admin
    .from("messages")
    .update({ content, edited_at: editedAt })
    .eq("id", id)
    .eq("shop_id", shopId);

  if (error && /edited_at/i.test(error.message)) {
    const r2 = await admin
      .from("messages")
      .update({ content })
      .eq("id", id)
      .eq("shop_id", shopId);
    error = r2.error;
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, edited_at: editedAt });
}
