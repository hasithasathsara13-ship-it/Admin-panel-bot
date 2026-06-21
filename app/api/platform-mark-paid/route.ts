import { NextRequest, NextResponse } from "next/server";
import { markBusinessPaid } from "@/lib/markPaidServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Platform-only: extend paid period and reset usage counters.
 *
 * Headers: x-platform-admin-secret: PLATFORM_ADMIN_SECRET
 * Body: { "shop_id": "<uuid>" }
 */
export async function POST(req: NextRequest) {
  const expected = process.env.PLATFORM_ADMIN_SECRET?.trim();
  const got = req.headers.get("x-platform-admin-secret")?.trim();
  if (!expected || got !== expected) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { shop_id?: string };
  try {
    body = (await req.json()) as { shop_id?: string };
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const shopId = typeof body.shop_id === "string" ? body.shop_id.trim() : "";
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const result = await markBusinessPaid(shopId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    billing_next_due_at: result.billing_next_due_at,
    billing_cycle: result.billing_cycle,
  });
}
