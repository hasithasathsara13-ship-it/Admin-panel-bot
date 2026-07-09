import { NextRequest, NextResponse } from "next/server";
import { requireVeloAdmin } from "@/lib/veloAdminRequest";
import { supabaseAdminForWhatsApp } from "@/lib/whatsappMetaPhone";
import { invalidatePlansCache } from "@/lib/plansDb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/velo-admin/plans
 * Returns all plans ordered by sort_order.
 */
export async function GET(req: NextRequest) {
  if (!requireVeloAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdminForWhatsApp;
  if (!admin) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  const { data, error } = await admin
    .from("plans")
    .select("*")
    .order("sort_order", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ plans: data ?? [] });
}

/**
 * PATCH /api/velo-admin/plans
 * Updates a plan and propagates changes to all businesses on that plan.
 *
 * Body: { id, display_name?, description?, monthly_price_lkr?, included_messages?, max_products?, features?, is_active? }
 */
export async function PATCH(req: NextRequest) {
  if (!requireVeloAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdminForWhatsApp;
  if (!admin) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const planId = typeof body.id === "string" ? body.id.trim() : "";
  if (!planId) {
    return NextResponse.json({ error: "Plan id is required" }, { status: 400 });
  }

  // Build patch
  const patch: Record<string, unknown> = {};

  if (body.display_name !== undefined) patch.display_name = String(body.display_name);
  if (body.description !== undefined) patch.description = String(body.description);
  if (body.monthly_price_lkr !== undefined) {
    const p = Number(body.monthly_price_lkr);
    if (!Number.isFinite(p) || p < 0) return NextResponse.json({ error: "Invalid price" }, { status: 400 });
    patch.monthly_price_lkr = Math.round(p);
  }
  if (body.included_messages !== undefined) {
    const m = Number(body.included_messages);
    if (!Number.isFinite(m) || m < 0) return NextResponse.json({ error: "Invalid message limit" }, { status: 400 });
    patch.included_messages = Math.round(m);
  }
  if (body.max_products !== undefined) {
    patch.max_products = body.max_products === null ? null : Math.round(Number(body.max_products));
  }
  if (body.max_orders_per_month !== undefined) {
    patch.max_orders_per_month = body.max_orders_per_month === null ? null : Math.round(Number(body.max_orders_per_month));
  }
  if (body.free_business_templates !== undefined) {
    const t = Number(body.free_business_templates);
    if (Number.isFinite(t) && t >= 0) patch.free_business_templates = Math.round(t);
  }
  if (body.service_convo_cap !== undefined) {
    const c = Number(body.service_convo_cap);
    if (Number.isFinite(c) && c >= 0) patch.service_convo_cap = Math.round(c);
  }
  if (body.features !== undefined) {
    patch.features = Array.isArray(body.features) ? body.features : [];
  }
  if (body.is_active !== undefined) {
    patch.is_active = Boolean(body.is_active);
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  // Update the plan
  const { error: updateErr } = await admin
    .from("plans")
    .update(patch)
    .eq("id", planId);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // Propagate message limit changes to existing businesses on this plan
  // This ensures current subscribers get the updated limits
  if (patch.included_messages !== undefined) {
    // The billing logic reads included_messages from the plans table dynamically,
    // but we also reset the buffer flag so businesses get the new allowance
    await admin
      .from("businesses")
      .update({ billing_buffer_notice_sent: false })
      .eq("billing_plan", planId);
  }

  // Invalidate server-side cache so all routes pick up new values immediately
  invalidatePlansCache();

  return NextResponse.json({ ok: true, updated: patch });
}
