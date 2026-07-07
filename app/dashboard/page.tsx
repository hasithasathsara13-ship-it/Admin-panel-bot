"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";
import { supabase } from "../../lib/supabaseClient";
import { getActiveShopId } from "../../lib/activeShopId";
import { normalizeOrderStatus } from "../../lib/orderStatus";
import { Card, CardContent } from "../../components/ui/card";
import { StatCard } from "../../components/ui/stat-card";
import { Skeleton } from "../../components/ui/skeleton";
import {
  IconBox, IconCheck, IconCustomers, IconInfo,
  IconOrders, IconRevenue, IconWarning,
} from "../../components/ui/icons";

// ─── Types ────────────────────────────────────────────────────────────────────

type OrderRow = {
  id: string;
  customer_phone: string;
  product_name: string;
  total_price: number;
  status: string;
  created_at: string;
  payment_method?: string;
};

type ProductRow = {
  id: string;
  name: string;
  price: number;
  stock_count: number;
  category?: string;
};

type Metrics = {
  totalRevenue: number;
  totalOrders: number;
  activeOrders: number;
  completedOrders: number;
  totalCustomers: number;
  totalProducts: number;
  revenueTrend: "up" | "down" | "flat" | "unknown";
  repeatCustomerRate: number;
  avgOrderValue: number;
};

type DailyRevenue = { date: string; revenue: number; orders: number };
type TopProduct = { name: string; count: number; revenue: number };
type HeatmapCell = { day: string; hour: number; count: number };
type AiInsight = { text: string; tone: "success" | "warning" | "info" | "prediction" };

const COLORS = ["#6366f1", "#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#64748b"];

function formatMoney(amount: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "LKR", maximumFractionDigits: 0 }).format(amount);
}

function getDayName(dayIndex: number): string {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dayIndex] ?? "";
}

// ─── Helper: build daily revenue from orders ──────────────────────────────────
function buildDailyRevenue(orders: OrderRow[], days: number): DailyRevenue[] {
  const now = new Date();
  const map = new Map<string, { revenue: number; orders: number }>();
  
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    map.set(key, { revenue: 0, orders: 0 });
  }

  for (const o of orders) {
    const key = new Date(o.created_at).toISOString().slice(0, 10);
    if (map.has(key)) {
      const entry = map.get(key)!;
      entry.revenue += Number(o.total_price) || 0;
      entry.orders += 1;
    }
  }

  return Array.from(map.entries()).map(([date, data]) => ({
    date: new Date(date).toLocaleDateString("en", { month: "short", day: "numeric" }),
    ...data,
  }));
}

// ─── Helper: top selling products ─────────────────────────────────────────────
function buildTopProducts(orders: OrderRow[]): TopProduct[] {
  const map = new Map<string, { count: number; revenue: number }>();
  for (const o of orders) {
    const name = o.product_name?.trim();
    if (!name) continue;
    const entry = map.get(name) ?? { count: 0, revenue: 0 };
    entry.count += 1;
    entry.revenue += Number(o.total_price) || 0;
    map.set(name, entry);
  }
  return Array.from(map.entries())
    .map(([name, data]) => ({ name: name.length > 20 ? name.slice(0, 20) + "…" : name, ...data }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
}

// ─── Helper: order heatmap ────────────────────────────────────────────────────
function buildHeatmap(orders: OrderRow[]): HeatmapCell[] {
  const grid: Record<string, Record<number, number>> = {};
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (const day of days) {
    grid[day] = {};
    for (let h = 0; h < 24; h++) grid[day][h] = 0;
  }
  for (const o of orders) {
    const d = new Date(o.created_at);
    const day = days[d.getDay()];
    const hour = d.getHours();
    grid[day][hour] = (grid[day][hour] || 0) + 1;
  }
  const result: HeatmapCell[] = [];
  for (const day of days) {
    for (let h = 0; h < 24; h++) {
      result.push({ day, hour: h, count: grid[day][h] });
    }
  }
  return result;
}

// ─── Helper: predict next week revenue using simple linear trend ──────────────
function predictRevenue(dailyData: DailyRevenue[]): { predicted: number; confidence: string } {
  if (dailyData.length < 7) return { predicted: 0, confidence: "low" };
  const last7 = dailyData.slice(-7);
  const total = last7.reduce((s, d) => s + d.revenue, 0);
  const avg = total / 7;
  
  // Simple trend: compare first half vs second half
  const first = last7.slice(0, 3).reduce((s, d) => s + d.revenue, 0) / 3;
  const second = last7.slice(4).reduce((s, d) => s + d.revenue, 0) / 3;
  const trend = second > first ? 1.1 : second < first ? 0.9 : 1.0;
  
  const predicted = Math.round(avg * 7 * trend);
  const confidence = dailyData.length >= 21 ? "high" : dailyData.length >= 14 ? "medium" : "low";
  return { predicted, confidence };
}

// ─── Main Dashboard Component ─────────────────────────────────────────────────

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aiInsights, setAiInsights] = useState<AiInsight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [chartDays, setChartDays] = useState<7 | 30>(30);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!supabase) {
        setError("Missing Supabase configuration");
        setLoading(false);
        return;
      }

      const shopId = getActiveShopId();
      if (!shopId) {
        setError("No shop selected. Please login again.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      // Fetch orders
      const ordersRes = await supabase
        .from("orders")
        .select("id, customer_phone, product_name, total_price, status, created_at, payment_method")
        .eq("shop_id", shopId)
        .order("created_at", { ascending: false });

      if (ordersRes.error) {
        if (!cancelled) { setError(ordersRes.error.message); setLoading(false); }
        return;
      }

      // Fetch products
      const productsRes = await supabase
        .from("products")
        .select("id, name, price, stock_count, category")
        .eq("shop_id", shopId);

      const allOrders = (ordersRes.data ?? []) as unknown as OrderRow[];
      const allProducts = (productsRes.data ?? []) as unknown as ProductRow[];

      if (cancelled) return;
      setOrders(allOrders);
      setProducts(allProducts);

      // Calculate metrics
      const totalRevenue = allOrders.reduce((sum, o) => sum + (Number(o.total_price) || 0), 0);
      const activeOrders = allOrders.filter(o => normalizeOrderStatus(o.status) === "pending").length;
      const completedOrders = allOrders.filter(o => normalizeOrderStatus(o.status) === "delivered").length;
      
      const phoneSet = new Set(allOrders.map(o => o.customer_phone?.trim()).filter(Boolean));
      const totalCustomers = phoneSet.size;

      // Repeat customer rate
      const phoneCounts = new Map<string, number>();
      for (const o of allOrders) {
        const p = o.customer_phone?.trim();
        if (p) phoneCounts.set(p, (phoneCounts.get(p) ?? 0) + 1);
      }
      const repeatCustomers = Array.from(phoneCounts.values()).filter(c => c > 1).length;
      const repeatCustomerRate = totalCustomers > 0 ? (repeatCustomers / totalCustomers) * 100 : 0;

      // Revenue trend
      const recent20 = allOrders.slice(0, 20);
      let revenueTrend: Metrics["revenueTrend"] = "unknown";
      if (recent20.length >= 6) {
        const prices = recent20.map(r => Number(r.total_price) || 0);
        const half = Math.floor(prices.length / 2);
        const a = prices.slice(0, half).reduce((s, n) => s + n, 0);
        const b = prices.slice(half).reduce((s, n) => s + n, 0);
        revenueTrend = Math.abs(a - b) < 1 ? "flat" : a > b ? "up" : "down";
      }

      setMetrics({
        totalRevenue,
        totalOrders: allOrders.length,
        activeOrders,
        completedOrders,
        totalCustomers,
        totalProducts: allProducts.length,
        revenueTrend,
        repeatCustomerRate,
        avgOrderValue: allOrders.length > 0 ? totalRevenue / allOrders.length : 0,
      });
      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, []);

  // Fetch AI insights
  const fetchAiInsights = useCallback(async () => {
    if (orders.length === 0) return;
    setInsightsLoading(true);
    
    const topProducts = buildTopProducts(orders);
    const ordersSummary = `Total orders: ${orders.length}. Total revenue: Rs.${metrics?.totalRevenue?.toLocaleString() ?? 0}. Top products: ${topProducts.map(p => `${p.name} (${p.count} orders, Rs.${p.revenue.toLocaleString()})`).join(", ")}. Active orders: ${metrics?.activeOrders ?? 0}. Completed: ${metrics?.completedOrders ?? 0}. Repeat customer rate: ${metrics?.repeatCustomerRate?.toFixed(0) ?? 0}%.`;
    const productsSummary = `${products.length} products. ${products.filter(p => p.stock_count === 0).length} out of stock. Categories: ${[...new Set(products.map(p => p.category).filter(Boolean))].join(", ") || "none"}.`;

    try {
      const res = await fetch("/api/dashboard-insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orders_summary: ordersSummary, products_summary: productsSummary }),
      });
      const data = await res.json();
      const insights: AiInsight[] = (data.insights ?? []).map((text: string) => ({
        text,
        tone: text.toLowerCase().includes("declin") || text.toLowerCase().includes("out of stock") || text.toLowerCase().includes("risk")
          ? "warning" as const
          : text.toLowerCase().includes("predict") || text.toLowerCase().includes("forecast") || text.toLowerCase().includes("expect")
            ? "prediction" as const
            : text.toLowerCase().includes("growth") || text.toLowerCase().includes("increas") || text.toLowerCase().includes("strong")
              ? "success" as const
              : "info" as const,
      }));
      setAiInsights(insights);
    } catch {
      setAiInsights([{ text: "Unable to fetch AI insights.", tone: "info" }]);
    }
    setInsightsLoading(false);
  }, [orders, products, metrics]);

  useEffect(() => {
    if (!loading && orders.length > 0) {
      void fetchAiInsights();
    }
  }, [loading, fetchAiInsights]);

  // Derived data for charts
  const dailyRevenue = useMemo(() => buildDailyRevenue(orders, chartDays), [orders, chartDays]);
  const topProducts = useMemo(() => buildTopProducts(orders), [orders]);
  const heatmap = useMemo(() => buildHeatmap(orders), [orders]);
  const prediction = useMemo(() => predictRevenue(dailyRevenue), [dailyRevenue]);
  const heatmapMax = useMemo(() => Math.max(1, ...heatmap.map(h => h.count)), [heatmap]);

  // Category breakdown for pie chart
  const categoryData = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of orders) {
      const cat = o.product_name?.split(" ")[0] ?? "Other";
      map.set(cat, (map.get(cat) ?? 0) + (Number(o.total_price) || 0));
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [orders]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div><Skeleton className="h-9 w-64 rounded-lg" /><Skeleton className="mt-2 h-4 w-48 rounded" /></div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
        <Skeleton className="h-72 rounded-2xl" />
        <div className="grid lg:grid-cols-2 gap-4">
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200/60 bg-red-50/80 px-4 py-3 text-sm text-red-700 shadow-sm">
        {error}
      </div>
    );
  }

  if (!metrics) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" style={{ color: "var(--color-text-primary)" }}>
            Dashboard
          </h1>
          <p className="mt-1 text-xs sm:text-sm" style={{ color: "var(--color-text-secondary)" }}>
            AI-powered business analytics and predictions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setChartDays(7)}
            className={["px-3 py-1.5 rounded-lg text-xs font-medium transition-all", chartDays === 7 ? "bg-[var(--color-accent)] text-white" : "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)]"].join(" ")}
          >
            7 days
          </button>
          <button
            onClick={() => setChartDays(30)}
            className={["px-3 py-1.5 rounded-lg text-xs font-medium transition-all", chartDays === 30 ? "bg-[var(--color-accent)] text-white" : "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)]"].join(" ")}
          >
            30 days
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Link href="/reports" className="block">
          <StatCard label="Total Revenue" value={formatMoney(metrics.totalRevenue)} hint={`Trend: ${metrics.revenueTrend}`} icon={<IconRevenue />} accent="violet" />
        </Link>
        <Link href="/orders" className="block">
          <StatCard label="Orders" value={metrics.totalOrders} hint={`${metrics.activeOrders} pending`} icon={<IconOrders />} accent="amber" />
        </Link>
        <Link href="/customers" className="block">
          <StatCard label="Customers" value={metrics.totalCustomers} hint={`${metrics.repeatCustomerRate.toFixed(0)}% repeat`} icon={<IconCustomers />} accent="sky" />
        </Link>
        <StatCard label="Avg Order" value={formatMoney(metrics.avgOrderValue)} hint={`${metrics.completedOrders} delivered`} icon={<IconCheck />} accent="emerald" />
      </div>

      {/* Revenue Chart + Prediction */}
      <Card>
        <CardContent>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>Revenue Trend</h2>
              <p className="text-xs mt-0.5" style={{ color: "var(--color-text-tertiary)" }}>
                Daily revenue over the last {chartDays} days
              </p>
            </div>
            {prediction.predicted > 0 && (
              <div className="sm:text-right">
                <div className="text-xs font-medium" style={{ color: "var(--color-text-tertiary)" }}>Next 7-day forecast</div>
                <div className="text-lg font-bold" style={{ color: "var(--color-accent)" }}>{formatMoney(prediction.predicted)}</div>
                <div className="text-[10px]" style={{ color: "var(--color-text-tertiary)" }}>Confidence: {prediction.confidence}</div>
              </div>
            )}
          </div>
          <div className="h-48 sm:h-56 md:h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyRevenue} margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
                <defs>
                  <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--color-text-tertiary)" }} interval={chartDays === 30 ? 4 : 0} />
                <YAxis tick={{ fontSize: 10, fill: "var(--color-text-tertiary)" }} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} width={35} />
                <Tooltip
                  contentStyle={{ background: "var(--color-surface-solid)", border: "1px solid var(--color-border-card)", borderRadius: 12, fontSize: 12 }}
                  formatter={(value: unknown) => [formatMoney(Number(value ?? 0)), "Revenue"]}
                />
                <Area type="monotone" dataKey="revenue" stroke="var(--color-accent)" strokeWidth={2} fill="url(#revenueGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Top Products + Category Breakdown */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Top Products Bar Chart */}
        <Card>
          <CardContent>
            <h2 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>Top Selling Products</h2>
            <p className="text-xs mt-0.5 mb-4" style={{ color: "var(--color-text-tertiary)" }}>By order count</p>
            {topProducts.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-sm" style={{ color: "var(--color-text-tertiary)" }}>No order data yet</div>
            ) : (
              <div className="h-48 sm:h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topProducts} layout="vertical" margin={{ top: 0, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: "var(--color-text-tertiary)" }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "var(--color-text-secondary)" }} width={80} />
                    <Tooltip
                      contentStyle={{ background: "var(--color-surface-solid)", border: "1px solid var(--color-border-card)", borderRadius: 12, fontSize: 12 }}
                      formatter={(value: unknown, name: unknown) => [String(name) === "count" ? `${value} orders` : formatMoney(Number(value ?? 0)), String(name) === "count" ? "Orders" : "Revenue"]}
                    />
                    <Bar dataKey="count" fill="var(--color-accent)" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Revenue by Category Pie */}
        <Card>
          <CardContent>
            <h2 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>Revenue by Product</h2>
            <p className="text-xs mt-0.5 mb-4" style={{ color: "var(--color-text-tertiary)" }}>Revenue distribution</p>
            {categoryData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-sm" style={{ color: "var(--color-text-tertiary)" }}>No data</div>
            ) : (
              <div className="h-48 sm:h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={categoryData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                      {categoryData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "var(--color-surface-solid)", border: "1px solid var(--color-border-card)", borderRadius: 12, fontSize: 12 }} formatter={(value: unknown) => formatMoney(Number(value ?? 0))} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Order Heatmap + AI Insights */}
      <div className="grid gap-4 lg:grid-cols-5">
        {/* Heatmap */}
        <Card className="lg:col-span-3 overflow-hidden">
          <CardContent className="px-3 sm:px-6">
            <h2 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>Order Activity Heatmap</h2>
            <p className="text-xs mt-0.5 mb-3" style={{ color: "var(--color-text-tertiary)" }}>When your customers order most</p>
            <div className="overflow-x-auto -mx-1">
              <div className="min-w-[320px]">
                <div className="flex gap-0.5 mb-1">
                  <div className="w-10 shrink-0" />
                  {[0, 3, 6, 9, 12, 15, 18, 21].map(h => (
                    <div key={h} className="flex-1 text-[9px] text-center" style={{ color: "var(--color-text-tertiary)" }}>
                      {h === 0 ? "12am" : h === 12 ? "12pm" : h < 12 ? `${h}am` : `${h-12}pm`}
                    </div>
                  ))}
                </div>
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(day => (
                  <div key={day} className="flex gap-0.5 mb-0.5">
                    <div className="w-10 shrink-0 text-[10px] font-medium flex items-center" style={{ color: "var(--color-text-tertiary)" }}>{day}</div>
                    {Array.from({ length: 24 }).map((_, h) => {
                      const cell = heatmap.find(c => c.day === day && c.hour === h);
                      const intensity = cell ? cell.count / heatmapMax : 0;
                      return (
                        <div
                          key={h}
                          className="flex-1 h-4 sm:h-5 rounded-sm transition-colors"
                          style={{
                            background: intensity === 0
                              ? "var(--color-surface-secondary)"
                              : `color-mix(in srgb, var(--color-accent) ${Math.round(intensity * 100)}%, var(--color-surface-secondary))`,
                          }}
                          title={`${day} ${h}:00 — ${cell?.count ?? 0} orders`}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* AI Insights */}
        <Card className="lg:col-span-2">
          <CardContent>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>🧠 AI Insights</h2>
                <p className="text-xs mt-0.5" style={{ color: "var(--color-text-tertiary)" }}>Powered by GPT-4</p>
              </div>
              <button
                onClick={() => void fetchAiInsights()}
                disabled={insightsLoading}
                className="text-[11px] font-medium px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50"
                style={{ color: "var(--color-accent)", background: "var(--color-accent-light)" }}
              >
                {insightsLoading ? "Analyzing…" : "↻ Refresh"}
              </button>
            </div>
            <div className="space-y-2">
              {insightsLoading ? (
                Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)
              ) : aiInsights.length === 0 ? (
                <div className="text-xs py-8 text-center" style={{ color: "var(--color-text-tertiary)" }}>Send some orders to get AI insights</div>
              ) : (
                aiInsights.map((insight, idx) => {
                  const toneColor = insight.tone === "warning" ? "var(--color-warning)" : insight.tone === "success" ? "var(--color-success)" : insight.tone === "prediction" ? "var(--color-accent)" : "var(--color-text-secondary)";
                  return (
                    <div
                      key={idx}
                      className="rounded-xl px-3 py-2.5 text-[12px] leading-relaxed border"
                      style={{ borderColor: "var(--color-border-card)", background: "var(--color-surface-secondary)", color: "var(--color-text-primary)" }}
                    >
                      <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: toneColor }} />
                      {insight.text}
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="py-4">
            <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--color-text-tertiary)" }}>Completion Rate</div>
            <div className="mt-1 text-xl font-bold" style={{ color: "var(--color-text-primary)" }}>
              {metrics.totalOrders > 0 ? ((metrics.completedOrders / metrics.totalOrders) * 100).toFixed(0) : 0}%
            </div>
            <div className="mt-2 h-1.5 rounded-full" style={{ background: "var(--color-surface-secondary)" }}>
              <div className="h-1.5 rounded-full bg-emerald-500 transition-all" style={{ width: `${metrics.totalOrders > 0 ? (metrics.completedOrders / metrics.totalOrders) * 100 : 0}%` }} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--color-text-tertiary)" }}>Repeat Customers</div>
            <div className="mt-1 text-xl font-bold" style={{ color: "var(--color-text-primary)" }}>{metrics.repeatCustomerRate.toFixed(0)}%</div>
            <div className="mt-2 h-1.5 rounded-full" style={{ background: "var(--color-surface-secondary)" }}>
              <div className="h-1.5 rounded-full bg-indigo-500 transition-all" style={{ width: `${metrics.repeatCustomerRate}%` }} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--color-text-tertiary)" }}>Products Listed</div>
            <div className="mt-1 text-xl font-bold" style={{ color: "var(--color-text-primary)" }}>{metrics.totalProducts}</div>
            <div className="mt-2 text-[11px]" style={{ color: "var(--color-text-tertiary)" }}>
              {products.filter(p => p.stock_count === 0).length} out of stock
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--color-text-tertiary)" }}>Revenue Forecast</div>
            <div className="mt-1 text-xl font-bold" style={{ color: "var(--color-accent)" }}>
              {prediction.predicted > 0 ? formatMoney(prediction.predicted) : "—"}
            </div>
            <div className="mt-2 text-[11px]" style={{ color: "var(--color-text-tertiary)" }}>
              Next 7 days ({prediction.confidence})
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
