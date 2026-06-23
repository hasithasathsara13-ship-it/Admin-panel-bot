"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type BusinessRow = {
  id: string;
  business_name: string | null;
  support_email: string | null;
  whatsapp_number: string | null;
  billing_plan: string | null;
  subscription_status: string | null;
  billing_next_due_at: string | null;
  billing_messages_used_period: number | null;
  messages_count_30d?: number;
  created_at: string | null;
};

function daysLeft(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diff = d.getTime() - Date.now();
  const days = Math.ceil(diff / (24 * 60 * 60 * 1000));
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "1 day left";
  return `${days} days left`;
}

function statusColor(s: string) {
  if (s === "active") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (s === "past_due") return "bg-amber-500/15 text-amber-300 border-amber-500/30";
  return "bg-red-500/15 text-red-300 border-red-500/30";
}

export default function VeloBusinessesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<BusinessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/velo-admin/businesses", { credentials: "include" });
    if (res.status === 401) {
      router.replace("/login?next=/velo-admin/businesses");
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { businesses?: BusinessRow[]; error?: string };
    if (!res.ok) {
      setError(data.error || "Failed to load");
      setRows([]);
      setLoading(false);
      return;
    }
    setRows(data.businesses ?? []);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = rows.filter((r) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (r.business_name || "").toLowerCase().includes(q) ||
      (r.support_email || "").toLowerCase().includes(q) ||
      (r.whatsapp_number || "").includes(q) ||
      r.id.includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Businesses</h1>
          <p className="mt-1 text-sm text-white/70">
            {loading ? "Loading…" : `${rows.length} workspace${rows.length !== 1 ? "s" : ""} registered`}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10"
          >
            Refresh
          </button>
          <Link
            href="/velo-admin/add-business"
            className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90"
          >
            + Add Business
          </Link>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
      )}

      {/* Search */}
      <div className="relative">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search businesses by name, email, number, or ID…"
          className="w-full rounded-xl border border-white/10 bg-[#0c101c] px-4 py-2.5 pl-10 text-sm text-white outline-none focus:border-indigo-500/50"
        />
        <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>

      {/* Business Cards */}
      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center text-white/70">
          <div className="flex flex-col items-center gap-3">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
            Loading…
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-[#0c101c]/80 p-12 text-center text-white/60">
          {search ? "No businesses match your search." : "No businesses yet. Add one to get started."}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((biz) => {
            const initials = (biz.business_name || "?")
              .trim()
              .split(/\s+/)
              .slice(0, 2)
              .map((w) => w[0])
              .join("")
              .toUpperCase();
            return (
              <Link
                key={biz.id}
                href={`/velo-admin/businesses/${biz.id}`}
                className="group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.04] to-transparent p-5 transition-all duration-200 hover:border-indigo-500/40 hover:shadow-lg hover:shadow-indigo-500/10"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/30 to-violet-500/20 text-sm font-bold text-indigo-100 ring-1 ring-inset ring-white/10">
                      {initials}
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-white truncate group-hover:text-indigo-200 transition-colors">
                        {biz.business_name || "Untitled"}
                      </h3>
                      <p className="text-[11px] text-white/40 font-mono truncate">
                        {biz.id.slice(0, 8)}…
                      </p>
                    </div>
                  </div>
                  <span className={`inline-flex flex-shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize ${statusColor(biz.subscription_status || "active")}`}>
                    {(biz.subscription_status || "active").replace("_", " ")}
                  </span>
                </div>

                <div className="mt-4 space-y-1.5 text-xs text-white/60">
                  {biz.support_email && (
                    <div className="flex items-center gap-2 truncate">
                      <span className="text-white/30">✉</span>
                      <span className="truncate">{biz.support_email}</span>
                    </div>
                  )}
                  {biz.whatsapp_number && (
                    <div className="flex items-center gap-2">
                      <span className="text-white/30">☎</span>
                      <span>{biz.whatsapp_number}</span>
                    </div>
                  )}
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3">
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-2 py-1 text-[11px] font-medium text-white/80">
                    {biz.billing_plan || "Starter"}
                  </span>
                  <span className="text-[11px] text-white/40">{daysLeft(biz.billing_next_due_at)}</span>
                </div>

                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-white/0 group-hover:text-white/30 transition-all duration-200 group-hover:translate-x-1">→</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
