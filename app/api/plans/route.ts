import { NextResponse } from "next/server";
import { getPlans } from "@/lib/plansDb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/plans
 * Public endpoint — returns active plans for the merchant dashboard.
 * No auth required (plans are public catalog info).
 */
export async function GET() {
  const plans = await getPlans();
  return NextResponse.json({ plans });
}
