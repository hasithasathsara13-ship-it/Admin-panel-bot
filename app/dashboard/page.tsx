"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";
import { getActiveShopId } from "../../lib/activeShopId";
import { normalizeOrderStatus } from "../../lib/orderStatus";
import { Card, CardContent } from "../../components/ui/card";
import { StatCard } from "../../components/ui/stat-card";
import { Skeleton } from "../../components/ui/skeleton";
import {
  IconBox,
  IconCheck,
  IconCustomers,
  IconInfo,
  IconOrders,
  IconRevenue,
  IconWarning,
} from "../../components/ui/icons";
import { EmptyState } from "../../components/ui/empty-state";

type Metrics = {
  totalRevenue: number;
  totalOrders: number;
  activeOrders: number;
  completedOrders: number;
  totalCustomers: number;
  totalProducts: number;
  revenueTrend: "up" | "down" | "flat" | "unknown";
};

function formatMoney(amount: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "LKR",
    maximumFractionDigits: 2,
  }).format(amount);
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6 theme-section-glow">
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="grid gap-0 divide-y divide-gray-200/40 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {Array.from({ length: 3 }).map((_, idx) => (
              <div key={idx} className="p-5">
                <Skeleton className="h-3 w-24 rounded" />
                <Skeleton className="mt-3 h-7 w-20 rounded" />
                <Skeleton className="mt-3 h-2 w-32 rounded" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, idx) => (
          <Card key={idx} className="overflow-hidden">
            <CardContent className="relative">
              <div className="absolute inset-0 bg-gradient-to-br from-zinc-200/40 via-zinc-100/20 to-transparent" />
              <div className="relative">
                <Skeleton className="h-3 w-24 rounded" />
                <Skeleton className="mt-3 h-8 w-32 rounded" />
                <Skeleton className="mt-3 h-3 w-20 rounded" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent>
          <Skeleton className="h-4 w-28 rounded" />
          <div className="mt-4 space-y-2">
            <Skeleton className="h-10 w-full rounded-xl" />
            <Skeleton className="h-10 w-5/6 rounded-xl" />
            <Skeleton className="h-10 w-4/6 rounded-xl" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function insightTone(text: string): "warning" | "success" | "info" {
  const t = text.toLowerCase();
  if (t.includes("declin") || t.includes("pending") || t.includes("no sales"))
    return "warning";
  if (t.includes("positive")) return "success";
  return "info";
}

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shopId, setShopId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!supabase) {
        setError(
          "Missing env vars: NEXT_PUBLIC_SUPABASE_URL and/or NEXT_PUBLIC_SUPABASE_ANON_KEY",
        );
        setLoading(false);
        return;
      }

      const currentShopId = getActiveShopId();
      if (!currentShopId) {
        setError("No shop selected. Please login again.");
        setLoading(false);
        return;
      }

      setShopId(currentShopId);
      setLoading(true);
      setError(null);

      // Pull once and derive metrics.
      // IMPORTANT: customers table may not exist, so we compute "total customers" from unique order phones.
      const ordersRes = await supabase
        .from("orders")
        .select("id,customer_phone,total_price,status,created_at,product_name")
        .eq("shop_id", currentShopId);
      if (ordersRes.error) {
        if (!cancelled) {
          setError(ordersRes.error.message);
          setLoading(false);
        }
        return;
      }

      const orders = ordersRes.data ?? [];
      const totalRevenue = orders.reduce((sum, row) => {
        const v = Number((row as { total_price: unknown }).total_price ?? 0);
        return sum + (Number.isFinite(v) ? v : 0);
      }, 0);
      const activeOrders = orders.filter(
        (row) => normalizeOrderStatus((row as { status: unknown }).status) === "pending",
      ).length;
      const completedOrders = orders.filter(
        (row) => normalizeOrderStatus((row as { status: unknown }).status) === "delivered",
      ).length;

      // Total customers = unique phone numbers found in orders.
      const totalCustomers = new Set(
        orders
          .map((row) => String((row as { customer_phone?: unknown }).customer_phone ?? "").trim())
          .filter(Boolean),
      ).size;

      // Product counts still come from products table.
      const productsRes = await supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("shop_id", currentShopId);

      if (productsRes.error) {
        if (!cancelled) {
          setError(productsRes.error.message);
          setLoading(false);
        }
        return;
      }

      // Simple revenue trend using recent orders (no external AI).
      // Compare sum of latest 10 vs previous 10 using descending id.
      const recent20 = await supabase
        .from("orders")
        .select("total_price,id")
        .order("id", { ascending: false })
        .limit(20)
        .eq("shop_id", currentShopId);

      let revenueTrend: Metrics["revenueTrend"] = "unknown";
      if (!recent20.error && recent20.data && recent20.data.length >= 6) {
        const prices = recent20.data.map((r) => {
          const v = Number((r as { total_price: unknown }).total_price ?? 0);
          return Number.isFinite(v) ? v : 0;
        });
        const half = Math.floor(prices.length / 2);
        const a = prices.slice(0, half).reduce((s, n) => s + n, 0);
        const b = prices.slice(half).reduce((s, n) => s + n, 0);
        const delta = a - b;
        if (Math.abs(delta) < 0.000001) revenueTrend = "flat";
        else revenueTrend = delta > 0 ? "up" : "down";
      }

      if (cancelled) return;

      setMetrics({
        totalRevenue,
        totalOrders: orders.length,
        activeOrders,
        completedOrders,
        totalCustomers,
        totalProducts: productsRes.count ?? 0,
        revenueTrend,
      });
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const insights = useMemo(() => {
    if (!metrics) return [];
    const list: string[] = [];

    if (metrics.totalRevenue <= 0) {
      list.push("No sales yet — system needs activation");
    }

    if (metrics.activeOrders > metrics.completedOrders) {
      list.push("High pending order rate detected");
    }

    if (metrics.totalProducts > 0 && metrics.totalCustomers > 0) {
      if (metrics.totalProducts < metrics.totalCustomers) {
        list.push("Low product availability compared to customer base");
      }
    }

    if (metrics.revenueTrend === "up") {
      list.push("Revenue trend is positive (recent orders)");
    } else if (metrics.revenueTrend === "down") {
      list.push("Revenue trend is declining (recent orders)");
    } else if (metrics.revenueTrend === "flat") {
      list.push("Revenue trend is flat (recent orders)");
    }

    if (list.length === 0) list.push("No notable signals yet — keep monitoring.");
    return list;
  }, [metrics]);

  const completionRate = metrics
    ? metrics.totalOrders > 0
      ? (metrics.completedOrders / metrics.totalOrders) * 100
      : 0
    : 0;
  const avgOrderValue = metrics
    ? metrics.totalOrders > 0
      ? metrics.totalRevenue / metrics.totalOrders
      : 0
    : 0;
  const customerCoverage = metrics
    ? metrics.totalCustomers > 0
      ? Math.min(100, (metrics.totalProducts / metrics.totalCustomers) * 100)
      : 0
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--color-text-primary)]">
            Dashboard Overview
          </h1>
          <p className="mt-1.5 text-sm text-[var(--color-text-secondary)]">
            Welcome back, Admin. Here&apos;s today&apos;s business snapshot.
          </p>
        </div>
        <div className="hidden text-sm font-medium text-[var(--color-text-tertiary)] lg:block">
          Live metrics powered by Supabase
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200/60 bg-red-50/80 px-4 py-3 text-sm text-red-700 shadow-sm">
          {error}
        </div>
      )}

      {loading ? (
        <DashboardSkeleton />
      ) : !metrics ? (
        <EmptyState
          icon={<IconBox className="h-6 w-6" />}
          title="No orders yet"
          description="Orders from WhatsApp customers will appear here"
          actionLabel="Create Test Order"
          onAction={async () => {
            const snippet = `-- Create a test order (adjust columns as needed)\ninsert into orders (customer_phone, product_name, total_price, status)\nvalues ('+10000000000', 'Test Product', 9.99, 'Pending');`;
            await navigator.clipboard.writeText(snippet);
          }}
        />
      ) : (
        <>
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <div className="grid gap-0 divide-y divide-gray-200/30 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                <div className="p-5">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
                    Order Completion
                  </div>
                  <div className="mt-2 text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
                    {completionRate.toFixed(1)}%
                  </div>
                  <div className="mt-3 h-1.5 rounded-full bg-[var(--color-surface-hover)]">
                    <div
                      className="h-1.5 rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all duration-500"
                      style={{ width: `${Math.max(6, Math.min(100, completionRate))}%` }}
                    />
                  </div>
                </div>

                <div className="p-5">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
                    Avg. Order Value
                  </div>
                  <div className="mt-2 text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
                    {formatMoney(avgOrderValue)}
                  </div>
                  <div className="mt-3 text-xs font-medium text-[var(--color-text-secondary)]">
                    Based on {metrics.totalOrders} total orders
                  </div>
                </div>

                <div className="p-5">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
                    Product Coverage
                  </div>
                  <div className="mt-2 text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
                    {customerCoverage.toFixed(0)}%
                  </div>
                  <div className="mt-3 h-1.5 rounded-full bg-[var(--color-surface-hover)]">
                    <div
                      className="h-1.5 rounded-full bg-gradient-to-r from-indigo-400 to-violet-500 transition-all duration-500"
                      style={{ width: `${Math.max(6, Math.min(100, customerCoverage))}%` }}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
            <Link href="/reports" className="block">
              <StatCard
                label="Total Revenue"
                value={formatMoney(metrics.totalRevenue)}
                hint={`Trend: ${metrics.revenueTrend}`}
                icon={<IconRevenue />}
                accent="violet"
                className="cursor-pointer"
              />
            </Link>
            <Link href="/orders" className="block">
              <StatCard
                label="Active Orders"
                value={metrics.activeOrders}
                hint="Pending"
                icon={<IconOrders />}
                accent="amber"
                className="cursor-pointer"
              />
            </Link>
            <Link href="/orders" className="block">
              <StatCard
                label="Completed Orders"
                value={metrics.completedOrders}
                hint="Delivered"
                icon={<IconCheck />}
                accent="emerald"
                className="cursor-pointer"
              />
            </Link>
            <Link href="/customers" className="block">
              <StatCard
                label="Total Customers"
                value={metrics.totalCustomers}
                hint="All time"
                icon={<IconCustomers />}
                accent="sky"
                className="cursor-pointer"
              />
            </Link>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardContent>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                      AI Insights
                    </div>
                    <div className="mt-1 text-sm text-[var(--color-text-secondary)]">
                      Signals and suggestions based on recent data.
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid gap-2">
                  {insights.map((text, idx) => {
                    const tone = insightTone(text);
                    const toneStyles =
                      tone === "warning"
                        ? "bg-amber-50/80 text-amber-800 ring-amber-200/50 shadow-sm shadow-amber-100/30"
                        : tone === "success"
                          ? "bg-emerald-50/80 text-emerald-800 ring-emerald-200/50 shadow-sm shadow-emerald-100/30"
                          : "bg-sky-50/80 text-sky-800 ring-sky-200/50 shadow-sm shadow-sky-100/30";
                    const Icon =
                      tone === "warning"
                        ? IconWarning
                        : tone === "success"
                          ? IconCheck
                          : IconInfo;

                    return (
                      <div
                        key={idx}
                      className={`flex items-start gap-3 rounded-xl px-4 py-3 text-sm ring-1 ring-inset transition-all duration-200 hover:shadow-sm ${toneStyles}`}
                      >
                        <div className="mt-0.5">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="leading-5">{text}</div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <div className="text-sm font-semibold text-[var(--color-text-primary)]">KPI Summary</div>
                <div className="mt-1 text-sm text-[var(--color-text-secondary)]">
                  Quick operational health indicators.
                </div>
                <div className="mt-4 space-y-3">
                  <div className="rounded-xl bg-gradient-to-r from-[var(--color-accent-light)] to-transparent px-4 py-3 ring-1 ring-inset ring-[var(--color-border-card)]">
                    <div className="text-[11px] uppercase tracking-wider text-[var(--color-text-secondary)]">
                      Total Orders
                    </div>
                    <div className="mt-1 text-lg font-bold text-[var(--color-text-primary)]">
                      {metrics.totalOrders}
                    </div>
                  </div>
                  <div className="rounded-xl bg-gradient-to-r from-[var(--color-warning-light)] to-transparent px-4 py-3 ring-1 ring-inset ring-[var(--color-border-card)]">
                    <div className="text-[11px] uppercase tracking-wider text-[var(--color-text-secondary)]">
                      Pending Queue
                    </div>
                    <div className="mt-1 text-lg font-bold text-amber-700">
                      {metrics.activeOrders}
                    </div>
                  </div>
                  <div className="rounded-xl bg-gradient-to-r from-[var(--color-success-light)] to-transparent px-4 py-3 ring-1 ring-inset ring-[var(--color-border-card)]">
                    <div className="text-[11px] uppercase tracking-wider text-[var(--color-text-secondary)]">
                      Delivered Queue
                    </div>
                    <div className="mt-1 text-lg font-bold text-emerald-700">
                      {metrics.completedOrders}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

