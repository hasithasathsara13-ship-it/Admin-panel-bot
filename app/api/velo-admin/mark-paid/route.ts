import { NextRequest, NextResponse } from "next/server";
import { markBusinessPaid } from "@/lib/markPaidServer";
import { requireVeloAdmin } from "@/lib/veloAdminRequest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!requireVeloAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
