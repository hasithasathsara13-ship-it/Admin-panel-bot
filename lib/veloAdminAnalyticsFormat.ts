import { normalizePlanName, planMonthlyEquivalentLkr, type BillingPlanName } from "@/lib/billing";

export type DailyPoint = { date: string; value: number };

/** UTC calendar dates `YYYY-MM-DD` for the last `days` days, oldest first. */
export function lastNDatesUtc(days: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Bucket `created_at` ISO strings into UTC calendar days (must match `dates` from `lastNDatesUtc`). */
export function messagesDailyFromCreatedAts(dates: string[], createdAts: string[]): DailyPoint[] {
  const dateSet = new Set(dates);
  const map = new Map<string, number>();
  for (const iso of createdAts) {
    if (!iso || iso.length < 10) continue;
    const key = iso.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !dateSet.has(key)) continue;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return dates.map((date) => ({ date, value: map.get(date) ?? 0 }));
}

export function fillDailySeries(
  dates: string[],
  rows: Array<{ bucket_date: string; total?: number | string | bigint; gmv?: number | string }>,
  field: "total" | "gmv",
): DailyPoint[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const key = String(r.bucket_date).slice(0, 10);
    const raw = field === "total" ? r.total : r.gmv;
    const n =
      typeof raw === "bigint"
        ? Number(raw)
        : typeof raw === "string"
          ? Number(raw)
          : Number(raw ?? 0);
    map.set(key, (map.get(key) ?? 0) + (Number.isFinite(n) ? n : 0));
  }
  return dates.map((date) => ({ date, value: map.get(date) ?? 0 }));
}

export function signupsDailyFromBusinesses(
  dates: string[],
  createdAts: string[],
): DailyPoint[] {
  const map = new Map<string, number>();
  for (const iso of createdAts) {
    const key = iso.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return dates.map((date) => ({ date, value: map.get(date) ?? 0 }));
}

export type BusinessForRevenue = {
  billing_plan: string | null;
  billing_cycle: string | null;
  subscription_status: string | null;
};

export function revenueFromBusinesses(rows: BusinessForRevenue[]): {
  mrrActiveLkr: number;
  arrActiveLkr: number;
  mrrExcludingCanceledLkr: number;
  payingActiveCount: number;
  breakdown: { plan: BillingPlanName; shops: number; mrrLkr: number }[];
} {
  const byPlan: Record<BillingPlanName, { shops: number; mrr: number }> = {
    Starter: { shops: 0, mrr: 0 },
    Growth: { shops: 0, mrr: 0 },
    Scale: { shops: 0, mrr: 0 },
  };

  let mrrActive = 0;
  let mrrNonCanceled = 0;
  let payingActive = 0;

  for (const r of rows) {
    const status = String(r.subscription_status ?? "active").trim();
    const plan = normalizePlanName(r.billing_plan);
    const mEq = planMonthlyEquivalentLkr(plan, r.billing_cycle);

    if (status !== "canceled") {
      mrrNonCanceled += mEq;
    }
    if (status === "active") {
      mrrActive += mEq;
      payingActive += 1;
      byPlan[plan].shops += 1;
      byPlan[plan].mrr += mEq;
    }
  }

  const breakdown = (Object.keys(byPlan) as BillingPlanName[]).map((plan) => ({
    plan,
    shops: byPlan[plan].shops,
    mrrLkr: Math.round(byPlan[plan].mrr * 100) / 100,
  }));

  return {
    mrrActiveLkr: Math.round(mrrActive * 100) / 100,
    arrActiveLkr: Math.round(mrrActive * 12 * 100) / 100,
    mrrExcludingCanceledLkr: Math.round(mrrNonCanceled * 100) / 100,
    payingActiveCount: payingActive,
    breakdown,
  };
}
