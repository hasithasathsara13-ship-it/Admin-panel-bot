"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "../../components/ui/card";
import { supabase } from "../../lib/supabaseClient";
import { getActiveShopId } from "../../lib/activeShopId";
import { Skeleton } from "../../components/ui/skeleton";
import { EmptyState } from "../../components/ui/empty-state";
import { IconBox } from "../../components/ui/icons";
import { normalizeOrderStatus } from "../../lib/orderStatus";

type MonthlyRow = {
  month: string;
  revenue: number;
  orders: number;
};

function formatMoney(value: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "LKR",
    maximumFractionDigits: 2,
  }).format(value);
}

export default function ReportsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [monthly, setMonthly] = useState<MonthlyRow[]>([]);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [revenueTotal, setRevenueTotal] = useState(0);
  const [completionRate, setCompletionRate] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadReports() {
      if (!supabase) {
        setError(
          "Missing env vars: NEXT_PUBLIC_SUPABASE_URL and/or NEXT_PUBLIC_SUPABASE_ANON_KEY",
        );
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      const shopId = getActiveShopId();
      if (!shopId) {
        setError("No shop selected. Please login again.");
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("orders")
        .select("created_at,total_price,status")
        .eq("shop_id", shopId);

      if (error) {
        if (!cancelled) {
          setError(error.message);
          setLoading(false);
        }
        return;
      }

      const rows = data ?? [];
      const monthlyMap = new Map<string, { revenue: number; orders: number }>();
      let delivered = 0;
      let totalRevenue = 0;

      for (const raw of rows) {
        const row = raw as Record<string, unknown>;
        const amount = Number(row.total_price ?? 0);
        const revenue = Number.isFinite(amount) ? amount : 0;
        totalRevenue += revenue;

        if (normalizeOrderStatus(row.status) === "delivered") delivered += 1;

        const dateText = String(row.created_at ?? "");
        const date = dateText ? new Date(dateText) : new Date();
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        const prev = monthlyMap.get(key) ?? { revenue: 0, orders: 0 };
        monthlyMap.set(key, { revenue: prev.revenue + revenue, orders: prev.orders + 1 });
      }

      const monthlyRows = Array.from(monthlyMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => {
          const [year, month] = key.split("-");
          const date = new Date(Number(year), Number(month) - 1, 1);
          const label = date.toLocaleString(undefined, {
            month: "short",
            year: "2-digit",
          });
          return { month: label, revenue: value.revenue, orders: value.orders };
        });

      if (!cancelled) {
        setMonthly(monthlyRows);
        setOrdersTotal(rows.length);
        setRevenueTotal(totalRevenue);
        setCompletionRate(rows.length ? (delivered / rows.length) * 100 : 0);
        setLoading(false);
      }
    }

    loadReports();
    return () => {
      cancelled = true;
    };
  }, []);

  const thisMonth = useMemo(() => {
    const now = new Date();
    const label = now.toLocaleString(undefined, { month: "short", year: "2-digit" });
    return monthly.find((m) => m.month === label) ?? null;
  }, [monthly]);

  const avgOrderValue = ordersTotal > 0 ? revenueTotal / ordersTotal : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">
          Reports
        </h1>
        <p className="mt-1.5 text-sm text-gray-500">
          Business performance snapshots and monthly trends.
        </p>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200/60 bg-red-50/80 px-4 py-3 text-sm text-red-700 shadow-sm">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="This Month Revenue"
          value={loading ? "..." : formatMoney(thisMonth?.revenue ?? 0)}
          loading={loading}
        />
        <Metric
          label="Orders This Month"
          value={loading ? "..." : String(thisMonth?.orders ?? 0)}
          loading={loading}
        />
        <Metric
          label="Avg Order Value"
          value={loading ? "..." : formatMoney(avgOrderValue)}
          loading={loading}
        />
        <Metric
          label="Completion Rate"
          value={loading ? "..." : `${completionRate.toFixed(1)}%`}
          loading={loading}
        />
      </div>

      {loading ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            {Array.from({ length: 5 }).map((_, idx) => (
              <Skeleton key={idx} className="h-10 w-full rounded-lg" />
            ))}
          </CardContent>
        </Card>
      ) : monthly.length === 0 ? (
        <EmptyState
          icon={<IconBox className="h-6 w-6" />}
          title="No report data yet"
          description="Reports will appear once orders are created."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="min-w-full text-left text-sm">
              <thead className="border-y border-gray-200/40 bg-gradient-to-r from-gray-50/60 via-slate-50/40 to-transparent">
                <tr>
                  <th className="px-5 py-3.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                    Month
                  </th>
                  <th className="px-5 py-3.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                    Revenue
                  </th>
                  <th className="px-5 py-3.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                    Orders
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200/40">
                {monthly.map((m, idx) => (
                  <tr key={m.month} className={`${idx % 2 === 0 ? "bg-white/50" : "bg-gray-50/30"} transition-colors duration-200 hover:bg-indigo-50/30`}>
                    <td className="px-5 py-3.5 font-medium text-gray-900">{m.month}</td>
                    <td className="px-5 py-3.5 text-gray-700">{formatMoney(m.revenue)}</td>
                    <td className="px-5 py-3.5 text-gray-700">{m.orders}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  loading,
}: {
  label: string;
  value: string;
  loading?: boolean;
}) {
  return (
    <Card className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/80 to-transparent" />
      <CardContent className="p-5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
          {label}
        </div>
        {loading ? (
          <Skeleton className="mt-2 h-8 w-24" />
        ) : (
          <div className="mt-2 text-2xl font-bold text-gray-900">{value}</div>
        )}
      </CardContent>
    </Card>
  );
}

