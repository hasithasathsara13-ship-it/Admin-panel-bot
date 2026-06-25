import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireVeloAdmin } from "@/lib/veloAdminRequest";
import { supabaseAdminForWhatsApp } from "@/lib/whatsappMetaPhone";
import { lastNDatesUtc } from "@/lib/veloAdminAnalyticsFormat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DAYS = 30;

async function messageCountsByShopFallback(
  admin: SupabaseClient,
  shopIds: string[],
  sinceIso: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  await Promise.all(
    shopIds.map(async (id) => {
      const { count, error } = await admin
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("shop_id", id)
        .gte("created_at", sinceIso);
      if (!error) map.set(id, count ?? 0);
    }),
  );
  return map;
}

const DEFAULT_BRAND_VOICE = "Friendly assistant speaking English and Singlish.";
const MAX_BRAND_VOICE_LEN = 12000;

export async function GET(req: NextRequest) {
  if (!requireVeloAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdminForWhatsApp;
  if (!admin) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  const { data, error } = await admin
    .from("businesses")
    .select(
      [
        "id",
        "business_name",
        "support_email",
        "whatsapp_number",
        "business_category",
        "billing_plan",
        "billing_cycle",
        "subscription_status",
        "billing_next_due_at",
        "billing_messages_used_period",
        "billing_quota_hard_block",
        "billing_last_marked_paid_at",
        "created_at",
        "brand_voice",
        "meta_phone_id",
        "meta_api_token",
        "waba_id",
        "bot_mode",
        "bot_enabled",
        "enable_ordering",
        "enable_reviews",
        "crm_access",
        "crm_billing_cycle",
      ].join(", "),
    )
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const businesses = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const shopIds = businesses
    .map((b) => (typeof b.id === "string" ? b.id : null))
    .filter((id): id is string => Boolean(id));

  const dates = lastNDatesUtc(DAYS);
  const sinceIso = `${dates[0]}T00:00:00.000Z`;

  let byShop = new Map<string, number>();
  const { data: countRows, error: countErr } = await admin.rpc("velo_admin_message_counts_by_shop_since", {
    p_since: sinceIso,
  });

  if (!countErr && Array.isArray(countRows)) {
    for (const row of countRows as Array<{ shop_id?: string; message_count?: number | string | bigint }>) {
      const sid = row.shop_id != null ? String(row.shop_id) : "";
      if (!sid) continue;
      const raw = row.message_count;
      const n =
        typeof raw === "bigint"
          ? Number(raw)
          : typeof raw === "string"
            ? Number(raw)
            : Number(raw ?? 0);
      byShop.set(sid, Number.isFinite(n) ? n : 0);
    }
  } else if (shopIds.length) {
    byShop = await messageCountsByShopFallback(admin, shopIds, sinceIso);
  }

  const enriched = businesses.map((b) => {
    const id = typeof b.id === "string" ? b.id : "";
    return {
      ...b,
      messages_count_30d: id ? (byShop.get(id) ?? 0) : 0,
    };
  });

  return NextResponse.json({ businesses: enriched, messages_count_since: sinceIso });
}

const SELECT_NEW =
  "id, business_name, support_email, whatsapp_number, billing_plan, billing_cycle, subscription_status, billing_next_due_at, billing_messages_used_period, billing_quota_hard_block, billing_last_marked_paid_at, created_at, brand_voice";

/**
 * POST body: { business_name (required), support_email?, whatsapp_number?, business_category?, brand_voice? }
 * Creates a platform-managed row (no owner_user_id) unless you later link one from the dashboard.
 */
export async function POST(req: NextRequest) {
  if (!requireVeloAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdminForWhatsApp;
  if (!admin) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  let body: {
    business_name?: string;
    support_email?: string | null;
    whatsapp_number?: string | null;
    business_category?: string | null;
    brand_voice?: string | null;
    meta_phone_id?: string | null;
    meta_api_token?: string | null;
    waba_id?: string | null;
    crm_access?: string;
    bot_mode?: string;
    bot_enabled?: boolean;
    enable_ordering?: boolean;
    enable_reviews?: boolean;
    billing_plan?: string;
    billing_cycle?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const businessName = typeof body.business_name === "string" ? body.business_name.trim() : "";
  if (!businessName) {
    return NextResponse.json({ error: "business_name is required" }, { status: 400 });
  }

  const insert: Record<string, unknown> = { business_name: businessName };

  if (body.support_email !== undefined) {
    const e = typeof body.support_email === "string" ? body.support_email.trim() : "";
    insert.support_email = e || null;
  }

  if (body.whatsapp_number !== undefined) {
    const w = typeof body.whatsapp_number === "string" ? body.whatsapp_number.trim() : "";
    insert.whatsapp_number = w || null;
  }

  if (body.business_category !== undefined) {
    const c = typeof body.business_category === "string" ? body.business_category.trim() : "";
    insert.business_category = c || null;
  }

  if (body.brand_voice !== undefined) {
    const bv = typeof body.brand_voice === "string" ? body.brand_voice.trim() : "";
    if (bv.length > MAX_BRAND_VOICE_LEN) {
      return NextResponse.json(
        { error: `brand_voice must be at most ${MAX_BRAND_VOICE_LEN} characters` },
        { status: 400 },
      );
    }
    insert.brand_voice = bv.length ? bv : DEFAULT_BRAND_VOICE;
  }

  if (body.meta_phone_id !== undefined) {
    const v = typeof body.meta_phone_id === "string" ? body.meta_phone_id.trim() : "";
    if (v) insert.meta_phone_id = v;
  }

  if (body.meta_api_token !== undefined) {
    const v = typeof body.meta_api_token === "string" ? body.meta_api_token.trim() : "";
    if (v) insert.meta_api_token = v;
  }

  if (body.waba_id !== undefined) {
    const v = typeof body.waba_id === "string" ? body.waba_id.trim() : "";
    if (v) insert.waba_id = v;
  }

  if (body.crm_access !== undefined && ["bot_only", "crm_only", "full"].includes(String(body.crm_access))) {
    insert.crm_access = body.crm_access;
  }

  if (body.bot_mode !== undefined && ["full_ecommerce", "reviews_only", "info_only"].includes(String(body.bot_mode))) {
    insert.bot_mode = body.bot_mode;
  }

  if (body.bot_enabled !== undefined) insert.bot_enabled = Boolean(body.bot_enabled);
  if (body.enable_ordering !== undefined) insert.enable_ordering = Boolean(body.enable_ordering);
  if (body.enable_reviews !== undefined) insert.enable_reviews = Boolean(body.enable_reviews);

  if (body.billing_plan !== undefined && ["Starter", "Growth", "Scale"].includes(String(body.billing_plan))) {
    insert.billing_plan = body.billing_plan;
  }

  if (body.billing_cycle !== undefined && ["Monthly", "Yearly"].includes(String(body.billing_cycle))) {
    insert.billing_cycle = body.billing_cycle;
  }

  const { data, error } = await admin.from("businesses").insert(insert).select(SELECT_NEW).single();

  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "23505") {
      return NextResponse.json(
        { error: "Duplicate value (for example WhatsApp number is already in use)." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ business: data });
}
