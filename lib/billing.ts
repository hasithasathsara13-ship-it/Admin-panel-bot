/** Product billing rules (LKR, monthly / yearly save 2 months = pay for 10 months per year). */

export const BILLING_GRACE_DAYS = 3;

export const MESSAGE_BUFFER_RATIO = 0.1;

export type BillingPlanName = "Starter" | "Growth" | "Scale";

export type BillingCycleName = "Monthly" | "Yearly";

export type SubscriptionStatus = "active" | "past_due" | "canceled";

export const PLAN_ORDER: BillingPlanName[] = ["Starter", "Growth", "Scale"];

export const PLAN_CONFIG: Record<
  BillingPlanName,
  { includedMessages: number; monthlyPriceLkr: number; description: string }
> = {
  Starter: {
    includedMessages: 2000,
    monthlyPriceLkr: 3500,
    description: "For small shops",
  },
  Growth: {
    includedMessages: 5000,
    monthlyPriceLkr: 6500,
    description: "For growing teams",
  },
  Scale: {
    includedMessages: 10000,
    monthlyPriceLkr: 12500,
    description: "For high-volume stores",
  },
};

export function normalizePlanName(raw: string | null | undefined): BillingPlanName {
  const t = String(raw ?? "").trim();
  if (t === "Growth" || t === "Scale") return t;
  return "Starter";
}

export function bufferExtraMessages(included: number): number {
  return Math.max(1, Math.floor(included * MESSAGE_BUFFER_RATIO));
}

export function hardCapMessages(included: number): number {
  return included + bufferExtraMessages(included);
}

/** Yearly invoice = 10 × monthly (two months free). */
export function yearlyTotalLkr(monthlyPriceLkr: number): number {
  return monthlyPriceLkr * 10;
}

/** Normalized monthly recurring amount for a shop (yearly → monthly equivalent). */
export function planMonthlyEquivalentLkr(
  plan: BillingPlanName,
  cycleRaw: string | null | undefined,
): number {
  const m = PLAN_CONFIG[plan].monthlyPriceLkr;
  if (String(cycleRaw ?? "").trim() === "Yearly") {
    return Math.round((yearlyTotalLkr(m) / 12) * 100) / 100;
  }
  return m;
}

export function courtesyOwnerMessage(input: {
  storeName: string;
  included: number;
  bufferExtra: number;
  hardCap: number;
}): string {
  const { storeName, included, bufferExtra, hardCap } = input;
  return [
    `📊 *Plan usage* (${storeName})`,
    ``,
    `You've used *100%* of your included messages (${included.toLocaleString()} / period).`,
    `We've added *${bufferExtra.toLocaleString()}* bonus messages (${Math.round(MESSAGE_BUFFER_RATIO * 100)}% courtesy) so conversations don't cut off mid-checkout.`,
    `Hard limit this period: *${hardCap.toLocaleString()}* messages.`,
    ``,
    `Need more volume? *Upgrade your plan* — reply here or open the dashboard → Settings → Billing and contact support.`,
  ].join("\n");
}

export function graceEndsAtIso(nextDueAt: string | null): string | null {
  if (!nextDueAt) return null;
  const d = new Date(nextDueAt);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + BILLING_GRACE_DAYS);
  return d.toISOString();
}

export function isPastDueBlocking(params: {
  subscriptionStatus: string | null | undefined;
  billingNextDueAt: string | null | undefined;
  now?: Date;
}): boolean {
  const { subscriptionStatus, billingNextDueAt, now = new Date() } = params;
  if (String(subscriptionStatus ?? "").trim() !== "past_due") return false;
  const due = billingNextDueAt ? new Date(billingNextDueAt) : null;
  if (!due || Number.isNaN(due.getTime())) return false;
  const graceEnd = new Date(due.getTime());
  graceEnd.setDate(graceEnd.getDate() + BILLING_GRACE_DAYS);
  if (now.getTime() < due.getTime()) return false;
  return now.getTime() > graceEnd.getTime();
}

export function isPastDueInGrace(params: {
  subscriptionStatus: string | null | undefined;
  billingNextDueAt: string | null | undefined;
  now?: Date;
}): boolean {
  const { subscriptionStatus, billingNextDueAt, now = new Date() } = params;
  if (String(subscriptionStatus ?? "").trim() !== "past_due") return false;
  const due = billingNextDueAt ? new Date(billingNextDueAt) : null;
  if (!due || Number.isNaN(due.getTime())) return false;
  const graceEnd = new Date(due.getTime());
  graceEnd.setDate(graceEnd.getDate() + BILLING_GRACE_DAYS);
  if (now.getTime() < due.getTime()) return false;
  return now.getTime() <= graceEnd.getTime();
}
