"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { supabase } from "../../lib/supabaseClient";
import { getActiveShopId } from "../../lib/activeShopId";
import { Skeleton } from "../../components/ui/skeleton";
import { normalizeOrderStatus } from "../../lib/orderStatus";

type CustomerView = {
  id: string;
  name: string;
  phone: string;
  orders: number;
  lastOrderAt: string | null;
  lastProductName: string | null;
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orderTotals, setOrderTotals] = useState({
    total: 0,
    pending: 0,
    delivered: 0,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadCustomers() {
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

      // IMPORTANT: No `customers` table in schema — derive everything from `orders`.
      // Use `select("*")` so we can infer the correct phone column(s) from real rows.
      const ordersRes = await supabase
        .from("orders")
        .select("*")
        .eq("shop_id", shopId);
      if (ordersRes.error) {
        if (!cancelled) {
          setError(ordersRes.error.message ?? "Failed to load customers.");
          setLoading(false);
        }
        return;
      }

      const orders = ordersRes.data ?? [];
      const byPhone = new Map<string, CustomerView>();
      let totalOrdersWithPhone = 0;
      let pendingOrders = 0;
      let deliveredOrders = 0;

      for (const raw of orders) {
        const row = raw as Record<string, unknown>;
        const phone = String(
          row.customer_phone ??
            row.phone ??
            row.customer_number ??
            row.customer_contact ??
            row.whatsapp_number ??
            "",
        ).trim();
        if (!phone) continue;

        totalOrdersWithPhone += 1;
        const total = Number(row.total_price ?? 0);
        const statusNorm = normalizeOrderStatus(row.status);
        const createdAtRaw = row.created_at ?? null;
        const createdAt = createdAtRaw ? String(createdAtRaw) : null;
        const productName = (row.product_name as string | null | undefined) ?? null;

        const prev =
          byPhone.get(phone) ??
          ({
            id: phone,
            name: phone,
            phone,
            orders: 0,
            lastOrderAt: null,
            lastProductName: null,
          } satisfies CustomerView);

        const next: CustomerView = {
          ...prev,
          orders: prev.orders + 1,
        };

        if (statusNorm === "pending") pendingOrders += 1;
        if (statusNorm === "delivered") deliveredOrders += 1;

        // Update "last" fields based on created_at, if available.
        if (createdAt) {
          const prevTime = prev.lastOrderAt ? new Date(prev.lastOrderAt).getTime() : 0;
          const nextTime = new Date(createdAt).getTime();
          if (Number.isFinite(nextTime) && nextTime >= prevTime) {
            next.lastOrderAt = createdAt;
            next.lastProductName = productName;
          }
        }

        byPhone.set(phone, next);
      }

      const merged = Array.from(byPhone.values()).sort(
        (a, b) => b.orders - a.orders,
      );

      if (!cancelled) {
        setCustomers(merged);
        setOrderTotals({
          total: totalOrdersWithPhone,
          pending: pendingOrders,
          delivered: deliveredOrders,
        });
        setLoading(false);
      }
    }

    loadCustomers();
    return () => {
      cancelled = true;
    };
  }, []);

  const totalCustomers = customers.length;
  const returningCustomers = customers.filter((c) => c.orders > 1).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">
          Customers
        </h1>
        <p className="mt-1.5 text-sm text-gray-500">
          Manage customer profiles and engagement history.
        </p>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200/60 bg-red-50/80 px-4 py-3 text-sm text-red-700 shadow-sm">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Total Customers
            </div>
            {loading ? (
              <Skeleton className="mt-2 h-9 w-16" />
            ) : (
              <div className="mt-2 text-3xl font-semibold text-zinc-900">
                {totalCustomers}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Total Orders
            </div>
            {loading ? (
              <Skeleton className="mt-2 h-9 w-16" />
            ) : (
              <div className="mt-2 text-3xl font-semibold text-zinc-900">
                {orderTotals.total}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Pending Orders
            </div>
            {loading ? (
              <Skeleton className="mt-2 h-9 w-16" />
            ) : (
              <div className="mt-2 text-3xl font-semibold text-zinc-900">
                {orderTotals.pending}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Delivered Orders
            </div>
            {loading ? (
              <Skeleton className="mt-2 h-9 w-16" />
            ) : (
              <div className="mt-2 text-3xl font-semibold text-zinc-900">
                {orderTotals.delivered}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold text-zinc-900">Customer Directory</h2>
        </CardHeader>
        <CardContent className="p-0">
          <table className="min-w-full text-left text-sm">
            <thead className="border-y border-gray-200/40 bg-gradient-to-r from-gray-50/60 via-slate-50/40 to-transparent">
              <tr>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-zinc-600">
                  Name
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-zinc-600">
                  Phone
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-zinc-600">
                  Orders
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-zinc-600">
                  Last Order
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200/40">
              {loading
                ? Array.from({ length: 5 }).map((_, idx) => (
                    <tr key={idx} className={idx % 2 === 0 ? "bg-white/50" : "bg-gray-50/30"}>
                      <td className="px-5 py-3"><Skeleton className="h-4 w-36" /></td>
                      <td className="px-5 py-3"><Skeleton className="h-4 w-28" /></td>
                      <td className="px-5 py-3"><Skeleton className="h-4 w-10" /></td>
                      <td className="px-5 py-3"><Skeleton className="h-4 w-24" /></td>
                    </tr>
                  ))
                : customers.map((customer, idx) => (
                <tr
                  key={customer.id}
                  className={idx % 2 === 0 ? "bg-white" : "bg-zinc-50/40"}
                >
                  <td className="px-5 py-3 font-medium text-zinc-900">{customer.name}</td>
                  <td className="px-5 py-3 text-zinc-700">{customer.phone}</td>
                  <td className="px-5 py-3 text-zinc-700">{customer.orders}</td>
                    <td className="px-5 py-3 text-zinc-700">
                      {customer.lastOrderAt ? new Date(customer.lastOrderAt).toLocaleDateString() : "—"}
                    </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

