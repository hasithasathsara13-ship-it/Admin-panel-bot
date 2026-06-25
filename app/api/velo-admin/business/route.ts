import { NextRequest, NextResponse } from "next/server";
import { requireVeloAdmin } from "@/lib/veloAdminRequest";
import { supabaseAdminForWhatsApp } from "@/lib/whatsappMetaPhone";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_BRAND_VOICE = "Friendly assistant speaking English and Singlish.";
const MAX_BRAND_VOICE_LEN = 12000;

const PLANS = new Set(["Starter", "Growth", "Scale"]);
const CYCLES = new Set(["Monthly", "Yearly"]);
const STATUSES = new Set(["active", "past_due", "canceled"]);

/**
 * PATCH body: { shop_id, billing_plan?, billing_cycle?, subscription_status?, billing_next_due_at?, brand_voice? }
 * billing_next_due_at: ISO string or null to clear
 * brand_voice: string (trimmed); empty string resets to the default assistant line
 */
export async function PATCH(req: NextRequest) {
  if (!requireVeloAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdminForWhatsApp;
  if (!admin) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  let body: {
    shop_id?: string;
    billing_plan?: string;
    billing_cycle?: string;
    subscription_status?: string;
    billing_next_due_at?: string | null;
    brand_voice?: string | null;
    waba_id?: string | null;
    meta_api_token?: string | null;
    meta_phone_id?: string | null;
    bot_mode?: string;
    bot_enabled?: boolean;
    enable_ordering?: boolean;
    enable_reviews?: boolean;
    crm_access?: string;
    crm_billing_cycle?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const shopId = typeof body.shop_id === "string" ? body.shop_id.trim() : "";
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};

  if (body.billing_plan != null) {
    const p = String(body.billing_plan).trim();
    if (!PLANS.has(p)) {
      return NextResponse.json({ error: "Invalid billing_plan" }, { status: 400 });
    }
    patch.billing_plan = p;
  }

  if (body.billing_cycle != null) {
    const c = String(body.billing_cycle).trim();
    if (!CYCLES.has(c)) {
      return NextResponse.json({ error: "Invalid billing_cycle" }, { status: 400 });
    }
    patch.billing_cycle = c;
  }

  if (body.subscription_status != null) {
    const s = String(body.subscription_status).trim();
    if (!STATUSES.has(s)) {
      return NextResponse.json({ error: "Invalid subscription_status" }, { status: 400 });
    }
    patch.subscription_status = s;
  }

  if (body.billing_next_due_at !== undefined) {
    if (body.billing_next_due_at === null || body.billing_next_due_at === "") {
      patch.billing_next_due_at = null;
    } else {
      const d = new Date(String(body.billing_next_due_at));
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: "Invalid billing_next_due_at" }, { status: 400 });
      }
      patch.billing_next_due_at = d.toISOString();
    }
  }

  if (body.brand_voice !== undefined) {
    if (body.brand_voice === null) {
      patch.brand_voice = DEFAULT_BRAND_VOICE;
    } else {
      const raw = String(body.brand_voice);
      if (raw.length > MAX_BRAND_VOICE_LEN) {
        return NextResponse.json(
          { error: `brand_voice must be at most ${MAX_BRAND_VOICE_LEN} characters` },
          { status: 400 },
        );
      }
      const trimmed = raw.trim();
      patch.brand_voice = trimmed.length ? trimmed : DEFAULT_BRAND_VOICE;
    }
  }

  if (body.waba_id !== undefined) {
    const w = typeof body.waba_id === "string" ? body.waba_id.trim() : "";
    patch.waba_id = w || null;
  }

  if (body.meta_api_token !== undefined) {
    const t = typeof body.meta_api_token === "string" ? body.meta_api_token.trim() : "";
    patch.meta_api_token = t || null;
  }

  if (body.meta_phone_id !== undefined) {
    const p = typeof body.meta_phone_id === "string" ? body.meta_phone_id.trim() : "";
    patch.meta_phone_id = p || null;
  }

  if (body.bot_mode !== undefined) {
    const m = String(body.bot_mode);
    if (!["full_ecommerce", "reviews_only", "info_only"].includes(m)) {
      return NextResponse.json({ error: "Invalid bot_mode" }, { status: 400 });
    }
    patch.bot_mode = m;
  }

  if (body.bot_enabled !== undefined) {
    patch.bot_enabled = Boolean(body.bot_enabled);
  }

  if (body.enable_ordering !== undefined) {
    patch.enable_ordering = Boolean(body.enable_ordering);
  }

  if (body.enable_reviews !== undefined) {
    patch.enable_reviews = Boolean(body.enable_reviews);
  }

  if (body.crm_access !== undefined) {
    const c = String(body.crm_access);
    if (!["bot_only", "crm_only", "full"].includes(c)) {
      return NextResponse.json({ error: "Invalid crm_access" }, { status: 400 });
    }
    patch.crm_access = c;
  }

  if (body.crm_billing_cycle !== undefined) {
    const c = String(body.crm_billing_cycle);
    if (!["Monthly", "Yearly"].includes(c)) {
      return NextResponse.json({ error: "Invalid crm_billing_cycle" }, { status: 400 });
    }
    patch.crm_billing_cycle = c;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { error } = await admin.from("businesses").update(patch).eq("id", shopId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
