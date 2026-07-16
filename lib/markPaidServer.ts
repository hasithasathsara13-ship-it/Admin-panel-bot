import { supabaseAdminForWhatsApp } from "@/lib/whatsappMetaPhone";

export function addBillingPeriod(from: Date, cycle: "Monthly" | "Yearly"): Date {
  const d = new Date(from.getTime());
  if (cycle === "Yearly") {
    d.setFullYear(d.getFullYear() + 1);
  } else {
    d.setMonth(d.getMonth() + 1);
  }
  return d;
}

export type MarkPaidResult =
  | { ok: true; billing_next_due_at: string; billing_cycle: "Monthly" | "Yearly" }
  | { ok: false; error: string; status: number };

export async function markBusinessPaid(shopId: string): Promise<MarkPaidResult> {
  const admin = supabaseAdminForWhatsApp;
  if (!admin) {
    return { ok: false, error: "Server not configured", status: 500 };
  }

  const { data: row, error: readErr } = await admin
    .from("businesses")
    .select("billing_cycle, billing_next_due_at")
    .eq("id", shopId)
    .maybeSingle();

  if (readErr || !row) {
    return {
      ok: false,
      error: readErr?.message ?? "Business not found",
      status: 404,
    };
  }

  const cycleRaw = String((row as { billing_cycle?: string }).billing_cycle ?? "Monthly").trim();
  const cycle: "Monthly" | "Yearly" = cycleRaw === "Yearly" ? "Yearly" : "Monthly";
  const priorDueRaw = (row as { billing_next_due_at?: string | null }).billing_next_due_at;

  const now = new Date();
  const priorDue = priorDueRaw ? new Date(priorDueRaw) : null;
  const base =
    priorDue && !Number.isNaN(priorDue.getTime()) && priorDue.getTime() > now.getTime()
      ? priorDue
      : now;

  const nextDue = addBillingPeriod(base, cycle);

  const { error: upErr } = await admin
    .from("businesses")
    .update({
      subscription_status: "active",
      billing_next_due_at: nextDue.toISOString(),
      billing_messages_used_period: 0,
      billing_templates_used_period: 0,
      billing_service_convos: 0,
      billing_buffer_notice_sent: false,
      billing_low_balance_notice_sent: false,
      billing_quota_hard_block: false,
      billing_last_marked_paid_at: now.toISOString(),
    })
    .eq("id", shopId);

  if (upErr) {
    return { ok: false, error: upErr.message, status: 500 };
  }

  return {
    ok: true,
    billing_next_due_at: nextDue.toISOString(),
    billing_cycle: cycle,
  };
}
