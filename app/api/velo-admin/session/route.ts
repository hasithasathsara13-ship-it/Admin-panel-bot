import { NextRequest, NextResponse } from "next/server";
import { requireVeloAdmin } from "@/lib/veloAdminRequest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!requireVeloAdmin(req)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
