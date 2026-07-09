/**
 * Server-side plan config fetched from the `plans` table.
 * This is the single source of truth for all billing logic.
 * Falls back to hardcoded defaults if the table doesn't exist.
 */

import { createClient } from "@supabase/supabase-js";

export type PlanRow = {
  id: string;
  display_name: string;
  description: string;
  monthly_price_lkr: number;
  included_messages: number;
  free_business_templates: number;
  service_convo_cap: number;
  max_products: number | null;
  max_orders_per_month: number | null;
  features: string[];
  is_active: boolean;
};

// Hardcoded defaults (used if plans table doesn't exist)
const DEFAULTS: PlanRow[] = [
  { id: "Starter", display_name: "Starter", description: "For small shops", monthly_price_lkr: 4900, included_messages: 1000, free_business_templates: 25, service_convo_cap: 1000, max_products: 50, max_orders_per_month: null, features: [], is_active: true },
  { id: "Growth", display_name: "Growth", description: "For growing teams", monthly_price_lkr: 9900, included_messages: 3000, free_business_templates: 50, service_convo_cap: 1000, max_products: 200, max_orders_per_month: null, features: [], is_active: true },
  { id: "Scale", display_name: "Scale", description: "For high-volume stores", monthly_price_lkr: 19900, included_messages: 6000, free_business_templates: 75, service_convo_cap: 1000, max_products: null, max_orders_per_month: null, features: [], is_active: true },
];

let _cached: PlanRow[] | null = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 60_000; // Re-fetch from DB every 60 seconds

function getAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * Fetch all active plans from the database.
 * Cached for 60 seconds to avoid hammering the DB on every message.
 */
export async function getPlans(): Promise<PlanRow[]> {
  if (_cached && Date.now() - _cacheTime < CACHE_TTL_MS) {
    return _cached;
  }

  const admin = getAdmin();
  if (!admin) return DEFAULTS;

  try {
    const { data, error } = await admin
      .from("plans")
      .select("id, display_name, description, monthly_price_lkr, included_messages, free_business_templates, service_convo_cap, max_products, max_orders_per_month, features, is_active")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (error || !data || data.length === 0) {
      return DEFAULTS;
    }

    _cached = data as PlanRow[];
    _cacheTime = Date.now();
    return _cached;
  } catch {
    return DEFAULTS;
  }
}

/**
 * Get a specific plan's config by ID.
 */
export async function getPlanById(planId: string): Promise<PlanRow | null> {
  const plans = await getPlans();
  return plans.find((p) => p.id === planId) ?? null;
}

/**
 * Get the message limit for a specific plan.
 */
export async function getPlanMessageLimit(planId: string): Promise<number> {
  const plan = await getPlanById(planId);
  return plan?.included_messages ?? 1000;
}

/**
 * Get the monthly price for a specific plan.
 */
export async function getPlanPrice(planId: string): Promise<number> {
  const plan = await getPlanById(planId);
  return plan?.monthly_price_lkr ?? 4900;
}

/**
 * Get the free business-initiated template quota for a specific plan.
 */
export async function getPlanFreeTemplates(planId: string): Promise<number> {
  const plan = await getPlanById(planId);
  return plan?.free_business_templates ?? 25;
}

/**
 * Get the service conversation cap for a specific plan.
 */
export async function getPlanServiceConvoCap(planId: string): Promise<number> {
  const plan = await getPlanById(planId);
  return plan?.service_convo_cap ?? 1000;
}

/**
 * Invalidate the cache (call after admin updates plans).
 */
export function invalidatePlansCache() {
  _cached = null;
  _cacheTime = 0;
}
