"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type AnalyticsPayload = {
  messagesDaily: { date: string; value: number }[];
  ordersGmvDaily: { date: string; value: number }[];
  signupsDaily: { date: string; value: number }[];
  revenue: {
    mrrActiveLkr: number;
    arrActiveLkr: number;
    mrrExcludingCanceledLkr: number;
    payingActiveCount: number;
    breakdown: { plan: string; shops: number; mrrLkr: number }[];
  };
  totals: {
    businesses: number;
    activeSubscriptions: number;
    pastDue: number;
    canceled: number;
    messagesInbound30d: number;
    ordersGmv30dLkr: number;
    billingPeriodMessagesReported: number;
  };
  rpc: { messages: string | null; orders: string | null };
};

function lkr(n: number) {
  return `LKR ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function Kpi({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: "indigo" | "emerald" | "amber" | "violet" | "slate";
}) {
  const ring =
    accent === "emerald"
      ? "from-emerald-500/20 to-teal-500/10 ring-emerald-500/20"
      : accent === "amber"
        ? "from-amber-500/20 to-orange-500/10 ring-amber-500/20"
        : accent === "violet"
          ? "from-violet-500/20 to-purple-500/10 ring-violet-500/20"
          : accent === "slate"
            ? "from-slate-500/15 to-slate-600/10 ring-white/10"
            : "from-indigo-500/25 to-violet-500/15 ring-indigo-500/25";
  return (
    <div
      className={`relative overflow-hidden rounded-2xl bg-gradient-to-br p-[1px] shadow-lg shadow-black/20 ring-1 ring-inset ${ring}`}
    >
      <div className="rounded-2xl bg-[#0c101c]/90 px-5 py-4 backdrop-blur-sm">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-white/75">{label}</div>
        <div className="mt-1.5 font-mono text-2xl font-bold tracking-tight text-white">{value}</div>
        {hint ? <div className="mt-1 text-xs text-white/75">{hint}</div> : null}
      </div>
    </div>
  );
}

const chartTooltip = {
  contentStyle: {
    background: "#12172a",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "12px",
    fontSize: "12px",
  },
  labelStyle: { color: "#e2e8f0" },
};

export default function VeloAnalyticsPage() {
  const router = useRouter();
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/velo-admin/analytics", { credentials: "include" });
    if (res.status === 401) {
      router.replace("/login?next=" + encodeURIComponent("/velo-admin/analytics"));
      return;
    }
    const json = (await res.json().catch(() => ({}))) as AnalyticsPayload & { error?: string };
    if (!res.ok) {
      setError(json.error || "Failed to load analytics");
      setData(null);
      setLoading(false);
      return;
    }
    setData(json as AnalyticsPayload);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const combined = useMemo(() => {
    if (!data) return [];
    return data.messagesDaily.map((m, i) => ({
      date: m.date,
      messages: m.value,
      gmv: data.ordersGmvDaily[i]?.value ?? 0,
      signups: data.signupsDaily[i]?.value ?? 0,
    }));
  }, [data]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-white/75">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          Loading analytics…
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
        {error || "No data"}
      </div>
    );
  }

  const rpcNote =
    data.rpc.messages || data.rpc.orders
      ? [data.rpc.messages, data.rpc.orders].filter(Boolean).join(" · ")
      : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Analytics</h1>
        <p className="mt-1 text-sm text-white/80">
          Subscription revenue (est.), platform-wide messaging, and merchant order volume.
        </p>
      </div>

      {rpcNote ? (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-xs text-amber-100/90">
          {rpcNote}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Est. MRR (active)"
          value={lkr(data.revenue.mrrActiveLkr)}
          hint={`${data.revenue.payingActiveCount} active paying workspaces`}
          accent="indigo"
        />
        <Kpi
          label="Est. ARR (active)"
          value={lkr(data.revenue.arrActiveLkr)}
          hint="MRR × 12 at current plans"
          accent="violet"
        />
        <Kpi
          label="Messages (30d)"
          value={data.totals.messagesInbound30d.toLocaleString()}
          hint="Rows in messages (all roles); WhatsApp inbound uses role user, dashboard replies use model"
          accent="emerald"
        />
        <Kpi
          label="Merchant GMV (30d)"
          value={lkr(data.totals.ordersGmv30dLkr)}
          hint="Sum of order totals (shops’ sales)"
          accent="amber"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Kpi
          label="Workspaces"
          value={String(data.totals.businesses)}
          hint={`${data.totals.activeSubscriptions} active · ${data.totals.pastDue} past due · ${data.totals.canceled} canceled`}
          accent="slate"
        />
        <Kpi
          label="Reported period usage"
          value={data.totals.billingPeriodMessagesReported.toLocaleString()}
          hint="Sum of billing counters (current period)"
          accent="slate"
        />
        <Kpi
          label="MRR incl. past due"
          value={lkr(data.revenue.mrrExcludingCanceledLkr)}
          hint="Non-canceled plans (rough exposure)"
          accent="slate"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-[#0c101c]/80 p-5 shadow-xl shadow-black/30">
          <div className="mb-4 flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-white">Messages & merchant GMV</h2>
              <p className="text-xs text-white/75">Last 30 days · dual axis</p>
            </div>
          </div>
          <div className="h-[280px] w-full min-h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={combined} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="msgFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "#e2e8f0", fontSize: 10 }}
                  tickFormatter={(d) => String(d).slice(5)}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fill: "#e2e8f0", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={36}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fill: "#e2e8f0", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                />
                <Tooltip
                  contentStyle={chartTooltip.contentStyle}
                  labelStyle={chartTooltip.labelStyle}
                />
                <Legend wrapperStyle={{ fontSize: "11px", color: "#e2e8f0" }} />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="messages"
                  name="Messages"
                  stroke="#818cf8"
                  strokeWidth={2}
                  fill="url(#msgFill)"
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="gmv"
                  name="GMV (LKR)"
                  stroke="#fbbf24"
                  strokeWidth={2}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#0c101c]/80 p-5 shadow-xl shadow-black/30">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-white">New workspaces</h2>
            <p className="text-xs text-white/75">Business signups per day (30d)</p>
          </div>
          <div className="h-[280px] w-full min-h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data.signupsDaily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="sigFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#a78bfa" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "#e2e8f0", fontSize: 10 }}
                  tickFormatter={(d) => String(d).slice(5)}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "#e2e8f0", fontSize: 10 }}
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                  width={28}
                />
                <Tooltip {...chartTooltip} />
                <Area
                  type="monotone"
                  dataKey="value"
                  name="Signups"
                  stroke="#c4b5fd"
                  strokeWidth={2}
                  fill="url(#sigFill)"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-[#0c101c]/80 p-6 shadow-xl shadow-black/30">
        <h2 className="text-sm font-semibold text-white">MRR by plan (active)</h2>
        <p className="text-xs text-white/75">Normalized monthly equivalent · yearly billed as 10× monthly ÷ 12</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {data.revenue.breakdown.map((b) => (
            <div key={b.plan} className="rounded-xl bg-white/5 p-4 ring-1 ring-inset ring-white/10">
              <div className="text-xs font-medium text-white/80">{b.plan}</div>
              <div className="mt-2 text-lg font-bold text-white">{lkr(b.mrrLkr)}</div>
              <div className="mt-1 text-xs text-white/75">{b.shops} shops</div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500"
                  style={{
                    width: `${data.revenue.mrrActiveLkr > 0 ? Math.min(100, (b.mrrLkr / data.revenue.mrrActiveLkr) * 100) : 0}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
