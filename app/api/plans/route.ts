import { NextResponse } from "next/server";
import { getPlans } from "@/lib/plansDb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/plans
 * Returns all active plans from the database (public endpoint for client-side billing UI).
 */
export async function GET() {
  const plans = await getPlans();
  return NextResponse.json({ plans });
}
