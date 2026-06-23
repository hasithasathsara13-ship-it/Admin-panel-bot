"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type BusinessRow = {
  id: string;
  business_name: string | null;
  whatsapp_number: string | null;
  billing_plan: string | null;
  billing_cycle: string | null;
  subscription_status: string | null;
  billing_next_due_at: string | null;
  billing_messages_used_period: number | null;
  billing_last_marked_paid_at: string | null;
};

const PLAN_PRICES: Record<string, number> = {
  Starter: 4900,
  Growth: 9900,
  Scale: 19900,
};

function lkr(n: number) {
  return `LKR ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function planMonthlyEquivalent(plan: string, cycle: string): number {
  const monthly = PLAN_PRICES[plan] ?? PLAN_PRICES.Starter;
  if (cycle === "Yearly") return Math.round((monthly * 10) / 12);
  return monthly;
}

function daysLeft(iso: string | null): { label: string; tone: "good" | "warn" | "bad" } {
  if (!iso) return { label: "—", tone: "good" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { label: "—", tone: "good" };
  const diff = d.getTime() - Date.now();
  const days = Math.ceil(diff / (24 * 60 * 60 * 1000));
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, tone: "bad" };
  if (days === 0) return { label: "Due today", tone: "warn" };
  if (days <= 3) return { label: `${days} days left`, tone: "warn" };
  return { label: `${days} days left`, tone: "good" };
}

export default function VeloBillingPage() {
  const router = useRouter();
  const [rows, setRows] = useState<BusinessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "past_due" | "canceled">("all");

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/velo-admin/businesses", { credentials: "include" });
    if (res.status === 401) {
      router.replace("/login?next=/velo-admin/billing");
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { businesses?: BusinessRow[]; error?: string };
    if (!res.ok) {
      setError(data.error || "Failed to load");
      setLoading(false);
      return;
    }
    setRows(data.businesses ?? []);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function updateBilling(id: string, patch: Record<string, unknown>) {
    setBusyId(id);
    setError(null);
    const res = await fetch("/api/velo-admin/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ shop_id: id, ...patch }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setBusyId(null);
    if (!res.ok) {
      setError(data.error || "Update failed");
      return;
    }
    await load();
  }

  async function markPaid(id: string) {
    setBusyId(id);
    setError(null);
    const res = await fetch("/api/velo-admin/mark-paid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ shop_id: id }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setBusyId(null);
    if (!res.ok) {
      setError(data.error || "Mark paid failed");
      return;
    }
    await load();
  }

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter !== "all" && (r.subscription_status || "active") !== statusFilter) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        (r.business_name || "").toLowerCase().includes(q) ||
        (r.whatsapp_number || "").includes(q)
      );
    });
  }, [rows, search, statusFilter]);

  const stats = useMemo(() => {
    let mrr = 0;
    let active = 0;
    let pastDue = 0;
    let canceled = 0;
    for (const r of rows) {
      const status = r.subscription_status || "active";
      if (status === "active") {
        active++;
        mrr += planMonthlyEquivalent(r.billing_plan || "Starter", r.billing_cycle || "Monthly");
      } else if (status === "past_due") {
        pastDue++;
      } else if (status === "canceled") {
        canceled++;
      }
    }
    return { mrr, arr: mrr * 12, active, pastDue, canceled };
  }, [rows]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Billing</h1>
        <p className="mt-1 text-sm text-white/60">Manage subscriptions, plans, and payment cycles across all workspaces.</p>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
      )}

      {/* Revenue Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-indigo-500/20 bg-gradient-to-br from-indigo-500/15 to-violet-500/5 p-5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-indigo-200/80">Est. MRR</div>
          <div className="mt-2 font-mono text-2xl font-bold text-white">{lkr(stats.mrr)}</div>
          <div className="mt-1 text-xs text-white/50">{stats.active} active subscriptions</div>
        </div>
        <div className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/15 to-purple-500/5 p-5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-violet-200/80">Est. ARR</div>
          <div className="mt-2 font-mono text-2xl font-bold text-white">{lkr(stats.arr)}</div>
          <div className="mt-1 text-xs text-white/50">MRR × 12</div>
        </div>
        <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/15 to-orange-500/5 p-5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-200/80">Past Due</div>
          <div className="mt-2 font-mono text-2xl font-bold text-white">{stats.pastDue}</div>
          <div className="mt-1 text-xs text-white/50">Need attention</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-500/10 to-slate-600/5 p-5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-white/60">Canceled</div>
          <div className="mt-2 font-mono text-2xl font-bold text-white">{stats.canceled}</div>
          <div className="mt-1 text-xs text-white/50">Churned workspaces</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search businesses…"
            className="velo-admin-input w-full rounded-xl border border-white/10 px-4 py-2.5 pl-10 text-sm outline-none focus:border-indigo-500/50"
          />
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <div className="flex gap-1 rounded-xl bg-white/5 p-1">
          {[
            { key: "all" as const, label: "All" },
            { key: "active" as const, label: "Active" },
            { key: "past_due" as const, label: "Past Due" },
            { key: "canceled" as const, label: "Canceled" },
          ].map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatusFilter(f.key)}
              className={[
                "rounded-lg px-3 py-1.5 text-xs font-medium transition",
                statusFilter === f.key ? "bg-white/10 text-white ring-1 ring-inset ring-white/10" : "text-white/60 hover:text-white",
              ].join(" ")}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Business Billing Cards */}
      {loading ? (
        <div className="flex min-h-[30vh] items-center justify-center text-white/60">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-[#0c101c]/80 p-12 text-center text-white/60">
          No businesses found.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((biz) => {
            const status = biz.subscription_status || "active";
            const plan = biz.billing_plan || "Starter";
            const cycle = biz.billing_cycle || "Monthly";
            const due = daysLeft(biz.billing_next_due_at);
            const busy = busyId === biz.id;
            return (
              <div
                key={biz.id}
                className="rounded-2xl border border-white/10 bg-[#0c101c]/80 p-5 transition hover:border-white/20"
              >
                <div className="flex flex-wrap items-center justify-between gap-4">
                  {/* Business info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/velo-admin/businesses/${biz.id}`}
                        className="text-sm font-semibold text-white hover:text-indigo-300 transition-colors truncate"
                      >
                        {biz.business_name || "Untitled"}
                      </Link>
                      <span className={[
                        "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize",
                        status === "active" ? "bg-emerald-500/15 text-emerald-300" : status === "past_due" ? "bg-amber-500/15 text-amber-300" : "bg-red-500/15 text-red-300",
                      ].join(" ")}>
                        {status.replace("_", " ")}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-white/50">
                      <span>{biz.whatsapp_number || "No number"}</span>
                      <span>·</span>
                      <span className={[
                        due.tone === "bad" ? "text-red-300" : due.tone === "warn" ? "text-amber-300" : "text-white/50",
                      ].join(" ")}>
                        {due.label}
                      </span>
                    </div>
                  </div>

                  {/* Plan & Cycle selectors */}
                  <div className="flex items-center gap-2">
                    <select
                      value={plan}
                      disabled={busy}
                      onChange={(e) => void updateBilling(biz.id, { billing_plan: e.target.value })}
                      className="velo-admin-select rounded-lg border border-white/10 px-3 py-1.5 text-xs outline-none focus:border-indigo-500/50"
                      style={{ colorScheme: "dark" }}
                    >
                      <option value="Starter">Starter — {lkr(PLAN_PRICES.Starter)}/mo</option>
                      <option value="Growth">Growth — {lkr(PLAN_PRICES.Growth)}/mo</option>
                      <option value="Scale">Scale — {lkr(PLAN_PRICES.Scale)}/mo</option>
                    </select>

                    {/* Monthly / Yearly toggle */}
                    <div className="flex rounded-lg bg-white/5 p-0.5">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void updateBilling(biz.id, { billing_cycle: "Monthly" })}
                        className={[
                          "rounded-md px-2.5 py-1 text-[11px] font-medium transition",
                          cycle === "Monthly" ? "bg-indigo-500 text-white" : "text-white/60 hover:text-white",
                        ].join(" ")}
                      >
                        Monthly
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void updateBilling(biz.id, { billing_cycle: "Yearly" })}
                        className={[
                          "rounded-md px-2.5 py-1 text-[11px] font-medium transition",
                          cycle === "Yearly" ? "bg-indigo-500 text-white" : "text-white/60 hover:text-white",
                        ].join(" ")}
                      >
                        Yearly
                      </button>
                    </div>

                    {/* Price display */}
                    <div className="text-right min-w-[90px]">
                      <div className="font-mono text-sm font-bold text-white">
                        {cycle === "Yearly" ? lkr(PLAN_PRICES[plan] * 10) : lkr(PLAN_PRICES[plan])}
                      </div>
                      <div className="text-[10px] text-white/40">{cycle === "Yearly" ? "per year" : "per month"}</div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void markPaid(biz.id)}
                      className="rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm disabled:opacity-40"
                    >
                      {busy ? "…" : "Mark Paid"}
                    </button>
                    {status === "active" ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void updateBilling(biz.id, { subscription_status: "past_due", billing_next_due_at: new Date().toISOString() })}
                        className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200 disabled:opacity-40"
                      >
                        Set Past Due
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void updateBilling(biz.id, { subscription_status: "active" })}
                        className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-white/80 disabled:opacity-40"
                      >
                        Set Active
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
