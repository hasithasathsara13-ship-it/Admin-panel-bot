"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "../../lib/supabaseClient";
import { botSync } from "../../lib/botSync";
import { getActiveShopId } from "../../lib/activeShopId";
import { normalizeOrderStatus } from "../../lib/orderStatus";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { IconBox } from "../../components/ui/icons";
import { Skeleton } from "../../components/ui/skeleton";
import { Card, CardContent } from "../../components/ui/card";
import { Table, TableShell, Td, Th } from "../../components/ui/table";

type OrderRow = {
  id: string | number;
  shop_id: string | null;
  customer_phone: string | null;
  product_name: string | null;
  total_price: number | null;
  delivery_address: string | null;
  status: string | null;
  created_at?: string | null;
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | number | null>(null);
  const [tab, setTab] = useState<"all" | "completed" | "pending">("all");
  const [search, setSearch] = useState("");

  function OrdersCardSkeleton() {
    return (
      <div className="space-y-3 md:hidden">
        {Array.from({ length: 5 }).map((_, idx) => (
          <Card key={idx} className="overflow-hidden">
            <CardContent className="space-y-3 p-4">
              <Skeleton className="h-3 w-32 rounded" />
              <Skeleton className="h-5 w-full max-w-[14rem] rounded" />
              <Skeleton className="h-6 w-24 rounded-full" />
              <div className="flex gap-2 pt-1">
                <Skeleton className="h-9 flex-1 rounded-lg" />
                <Skeleton className="h-9 flex-1 rounded-lg" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  function OrdersSkeleton() {
    return (
      <TableShell>
        <Table>
          <thead className="border-b border-gray-200/50 bg-gray-50/60">
            <tr>
              <Th>Customer Phone</Th>
              <Th>Product Name</Th>
              <Th>Address</Th>
              <Th>Total Price</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 6 }).map((_, idx) => (
              <tr key={idx} className={idx % 2 === 0 ? "bg-white/60" : "bg-gray-50/30"}>
                <Td>
                  <Skeleton className="h-4 w-28 rounded" />
                </Td>
                <Td>
                  <Skeleton className="h-4 w-36 rounded" />
                </Td>
                <Td>
                  <Skeleton className="h-4 w-48 rounded" />
                </Td>
                <Td>
                  <Skeleton className="h-4 w-20 rounded" />
                </Td>
                <Td>
                  <Skeleton className="h-6 w-24 rounded-full" />
                </Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-9 w-24 rounded-lg" />
                    <Skeleton className="h-9 w-24 rounded-lg" />
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableShell>
    );
  }

  function OrdersSkeletonDesktop() {
    return (
      <div className="hidden md:block">
        <OrdersSkeleton />
      </div>
    );
  }

  async function loadOrders() {
    if (!supabase) {
      setError(
        "Missing env vars: NEXT_PUBLIC_SUPABASE_URL and/or NEXT_PUBLIC_SUPABASE_ANON_KEY",
      );
      setLoading(false);
      return;
    }

    const shopId = getActiveShopId();
    if (!shopId) {
      setError("No shop selected. Please login again.");
      setOrders([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("shop_id", shopId);

    if (error) {
      setError(error.message);
      setOrders([]);
      setLoading(false);
      return;
    }

    setOrders((data ?? []) as OrderRow[]);
    setLoading(false);
  }

  useEffect(() => {
    loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const normalizedOrders = useMemo(() => {
    return orders.map((o) => ({
      ...o,
      _statusNorm: normalizeOrderStatus(o.status),
    }));
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();

    return normalizedOrders.filter((o) => {
      const statusOk =
        tab === "all"
          ? true
          : tab === "pending"
            ? o._statusNorm === "pending"
            : o._statusNorm === "delivered";

      const searchOk =
        !q ||
        String(o.customer_phone ?? "").toLowerCase().includes(q) ||
        String(o.product_name ?? "").toLowerCase().includes(q) ||
        String(o.delivery_address ?? "").toLowerCase().includes(q);

      return statusOk && searchOk;
    });
  }, [normalizedOrders, search, tab]);

  const counts = useMemo(() => {
    const total = normalizedOrders.length;
    const pending = normalizedOrders.filter((o) => o._statusNorm === "pending").length;
    const delivered = normalizedOrders.filter((o) => o._statusNorm === "delivered").length;
    const cancelled = Math.max(0, total - pending - delivered);
    return { total, pending, delivered, cancelled };
  }, [normalizedOrders]);

  const [notifyStatus, setNotifyStatus] = useState<string | null>(null);

  async function markDelivered(orderId: string | number) {
    if (!supabase) return;

    setUpdatingId(orderId);
    setError(null);
    setNotifyStatus(null);

    const order = orders.find((o) => o.id === orderId) ?? null;
    const targetShopId = order?.shop_id ?? getActiveShopId();
    if (!targetShopId) {
      setNotifyStatus("⚠️ Could not resolve shop id for this order");
      setUpdatingId(null);
      return;
    }

    const { error } = await supabase
      .from("orders")
      .update({
        status: "Delivered",
      })
      .eq("shop_id", targetShopId)
      .eq("id", orderId);

    if (error) {
      setError(error.message);
      setUpdatingId(null);
      return;
    }

    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, status: "Delivered" } : o)),
    );
    setUpdatingId(null);

    if (order) {
      const event = botSync.ORDER_STATUS_UPDATE({
        order_id: order.id,
        customer_phone: order.customer_phone,
        status: "Delivered",
        product_name: order.product_name,
      });
      console.log(event);

      // Send WhatsApp delivery notification to the customer
      if (order.customer_phone) {
        try {
          const res = await fetch("/api/notify-delivery", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              shop_id: targetShopId,
              order_id: order.id,
              customer_phone: order.customer_phone,
              product_name: order.product_name,
            }),
          });

          if (res.ok) {
            setNotifyStatus("✅ Delivery notification sent to customer via WhatsApp");
          } else {
            const data = await res.json().catch(() => ({}));
            setNotifyStatus(`⚠️ Could not send WhatsApp notification: ${data.error || "Unknown error"}`);
          }
        } catch {
          setNotifyStatus("⚠️ Could not send WhatsApp notification");
        }

        // Auto-dismiss notification after 5 seconds
        setTimeout(() => setNotifyStatus(null), 5000);
      }
    }
  }

  function openWhatsApp(phone: string | null) {
    if (!phone) return;
    const normalized = phone.replace(/[^\d+]/g, "");
    window.open(`https://wa.me/${normalized}`, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="space-y-4 pb-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--color-text-primary)]">
            Orders
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-[var(--color-text-secondary)]">
            Review, update, and message customers.
          </p>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200/60 bg-red-50/80 px-4 py-3 text-sm text-red-700 shadow-sm">
          {error}
        </div>
      ) : null}

      {notifyStatus ? (
        <div
          className={[
            "flex items-center gap-3 rounded-2xl px-4 py-3 text-sm shadow-sm animate-slide-up transition-all duration-300",
            notifyStatus.startsWith("✅")
              ? "border border-emerald-200/60 bg-emerald-50/80 text-emerald-700"
              : "border border-amber-200/60 bg-amber-50/80 text-amber-700",
          ].join(" ")}
        >
          <span className="flex-1">{notifyStatus}</span>
          <button
            type="button"
            onClick={() => setNotifyStatus(null)}
            className="shrink-0 rounded-lg p-1 text-current opacity-60 transition-opacity hover:opacity-100"
            aria-label="Dismiss"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, idx) => (
              <div
                key={idx}
                className="theme-panel rounded-2xl p-5"
              >
                <Skeleton className="h-3 w-28 rounded" />
                <Skeleton className="mt-3 h-8 w-20 rounded" />
                <Skeleton className="mt-2 h-2 w-24 rounded-full" />
              </div>
            ))}
          </div>
          <OrdersCardSkeleton />
          <OrdersSkeletonDesktop />
        </div>
      ) : filteredOrders.length === 0 ? (
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
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
            <KpiCard label="Total Orders" value={counts.total} />
            <KpiCard label="New Orders" value={counts.pending} />
            <KpiCard label="Completed" value={counts.delivered} />
            <KpiCard label="Cancelled" value={counts.cancelled} />
          </div>

          <div className="theme-panel-strong rounded-2xl">
            <div className="flex flex-col gap-3 border-b border-[var(--color-border-card)] p-3 sm:p-4">
              {/* Status filter + Search */}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-1.5">
                  <TabChip active={tab === "all"} onClick={() => setTab("all")}>
                    All
                  </TabChip>
                  <TabChip active={tab === "pending"} onClick={() => setTab("pending")}>
                    Pending
                  </TabChip>
                  <TabChip active={tab === "completed"} onClick={() => setTab("completed")}>
                    Completed
                  </TabChip>
                </div>

                <div className="flex w-full max-w-sm items-center rounded-xl border border-[var(--panel-border-soft)] bg-[var(--panel-input-bg)] px-3 transition-all duration-200 focus-within:border-[var(--color-accent)] focus-within:bg-[var(--panel-input-focus-bg)] focus-within:ring-2 focus-within:ring-[var(--color-accent-glow)]">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-[var(--panel-icon)]"><path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" /></svg>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search orders..."
                    className="h-10 w-full bg-transparent px-2 text-[16px] sm:text-sm text-[var(--color-text-primary)] outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="hidden md:block">
              <TableShell className="rounded-none border-0 shadow-none">
                <Table>
                  <thead className="theme-table-head">
                    <tr>
                      <Th>Customer Phone</Th>
                      <Th>Product</Th>
                      <Th>Address</Th>
                      <Th>Total Price</Th>
                      <Th>Status</Th>
                      <Th>Actions</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border-card)]">
                    {filteredOrders.map((o) => {
                      const isPending = o._statusNorm === "pending";
                      const isDelivered = o._statusNorm === "delivered";
                      const isUpdating = updatingId === o.id;

                      return (
                        <tr
                          key={String(o.id)}
                          className="theme-row-alt text-[var(--color-text-secondary)] transition-colors duration-200"
                        >
                          <Td className="font-medium text-[var(--color-text-primary)]">
                            {o.customer_phone ?? "—"}
                          </Td>
                          <Td>{o.product_name ?? "—"}</Td>
                          <Td>{o.delivery_address ?? "—"}</Td>
                          <Td>{o.total_price ?? "—"}</Td>
                          <Td>
                            <OrderStatusBadge
                              o={o}
                              isPending={isPending}
                              isDelivered={isDelivered}
                              isUpdating={isUpdating}
                            />
                          </Td>
                          <Td>
                            <OrderActionButtons
                              isPending={isPending}
                              isUpdating={isUpdating}
                              onInquire={() => openWhatsApp(o.customer_phone)}
                              onDeliver={() => markDelivered(o.id)}
                              disabledInquire={!o.customer_phone}
                            />
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </TableShell>
            </div>

            <div className="space-y-3 p-3 pb-24 md:hidden md:pb-3">
              {filteredOrders.map((o) => {
                const isPending = o._statusNorm === "pending";
                const isDelivered = o._statusNorm === "delivered";
                const isUpdating = updatingId === o.id;

                return (
                  <div
                    key={String(o.id)}
                    className="rounded-2xl border p-4 transition-all"
                    style={{ borderColor: "var(--color-border-card)", background: "var(--color-surface-solid)" }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-[15px] font-semibold truncate" style={{ color: "var(--color-text-primary)" }}>
                          {o.product_name ?? "—"}
                        </div>
                        <div className="mt-0.5 text-xs font-mono" style={{ color: "var(--color-text-tertiary)" }}>
                          {o.customer_phone ?? "—"}
                        </div>
                      </div>
                      <OrderStatusBadge
                        o={o}
                        isPending={isPending}
                        isDelivered={isDelivered}
                        isUpdating={isUpdating}
                      />
                    </div>
                    {o.delivery_address && (
                      <div className="mt-2 text-xs leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
                        📍 {o.delivery_address}
                      </div>
                    )}
                    {o.total_price != null && (
                      <div className="mt-1.5 text-sm font-bold" style={{ color: "var(--color-text-primary)" }}>
                        Rs. {Number(o.total_price).toLocaleString()}
                      </div>
                    )}
                    <div className="mt-3 pt-3 flex gap-2" style={{ borderTop: "1px solid var(--color-border-light)" }}>
                      <OrderActionButtons
                        isPending={isPending}
                        isUpdating={isUpdating}
                        onInquire={() => openWhatsApp(o.customer_phone)}
                        onDeliver={() => markDelivered(o.id)}
                        disabledInquire={!o.customer_phone}
                        fullWidth
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OrderStatusBadge({
  o,
  isPending,
  isDelivered,
  isUpdating,
}: {
  o: { status: string | null };
  isPending: boolean;
  isDelivered: boolean;
  isUpdating: boolean;
}) {
  if (isPending) {
    return (
      <Badge variant="pending">
        {isUpdating ? "Updating…" : "Pending"}
      </Badge>
    );
  }
  return (
    <Badge variant={isDelivered ? "delivered" : "neutral"}>
      {isDelivered ? "Delivered" : String(o.status ?? "Unknown")}
    </Badge>
  );
}

function OrderActionButtons({
  isPending,
  isUpdating,
  onInquire,
  onDeliver,
  disabledInquire,
  fullWidth,
}: {
  isPending: boolean;
  isUpdating: boolean;
  onInquire: () => void;
  onDeliver: () => void;
  disabledInquire: boolean;
  fullWidth?: boolean;
}) {
  const deliverLabel =
    fullWidth && isPending
      ? isUpdating
        ? "Updating…"
        : "Delivered"
      : isUpdating
        ? "Updating…"
        : "Mark Delivered";

  return (
    <div
      className={
        fullWidth
          ? "flex w-full gap-2 [&_button]:h-11 [&_button]:min-h-[2.75rem] [&_button]:flex-1"
          : "flex items-center gap-2"
      }
    >
      <Button
        variant="whatsapp"
        size="sm"
        onClick={onInquire}
        disabled={disabledInquire}
      >
        Inquire
      </Button>
      {isPending ? (
        <Button variant="ghost" size="sm" onClick={onDeliver} disabled={isUpdating}>
          {deliverLabel}
        </Button>
      ) : (
        <Button variant="ghost" size="sm" disabled>
          Delivered
        </Button>
      )}
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: number }) {
  const bar = Math.max(8, Math.min(100, value));
  return (
    <div className="theme-panel relative overflow-hidden rounded-2xl p-4 sm:p-5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-hover)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--color-text-tertiary)]/30 to-transparent" />
      <div className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
        {label}
      </div>
      <div className="mt-2 sm:mt-3 text-xl sm:text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
        {value}
      </div>
      <div className="mt-2 sm:mt-3 h-1.5 w-full rounded-full bg-[var(--color-surface-hover)]">
        <div
          className="h-1.5 rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-500"
          style={{ width: `${bar}%` }}
        />
      </div>
    </div>
  );
}

function TabChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-full px-4 py-1.5 text-xs font-semibold transition-all duration-200",
        active
          ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm shadow-indigo-200/50"
          : "bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-light)] hover:text-[var(--color-text-primary)]",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

