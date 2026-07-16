"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BILLING_GRACE_DAYS,
  graceEndsAtIso,
  isPastDueBlocking,
  isPastDueInGrace,
} from "../../lib/billing";
import { getActiveShopId } from "../../lib/activeShopId";
import { subscribeToPush, unsubscribeFromPush } from "../../lib/pushClient";
import {
  loadAdminNotificationFeed,
  saveAdminNotificationFeed,
  type AdminNotificationFeedItem,
} from "../../lib/adminNotificationFeedStorage";
import { supabase } from "../../lib/supabaseClient";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { BottomNav } from "./BottomNav";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isMessagesRoute = pathname === "/messages" || pathname.startsWith("/messages/");
  const isChatRoute = pathname === "/messages"; // Only the chat page gets overflow-hidden

  const [sessionLoading, setSessionLoading] = useState(true);
  const [session, setSession] = useState<unknown>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [notificationFeed, setNotificationFeed] = useState<AdminNotificationFeedItem[]>([]);
  const [notificationFeedUnread, setNotificationFeedUnread] = useState(0);
  const notificationFeedShopRef = useRef<string | null>(null);
  const notificationFeedSeenIdsRef = useRef<Set<string>>(new Set());

  const [billingOverlay, setBillingOverlay] = useState<{
    blockMain: boolean;
    paymentDueGrace: boolean;
    nextDue: string | null;
    graceEndsIso: string | null;
    quotaHardBlock: boolean;
    dueIn1Day: boolean;
  } | null>(null);

  const isLoginRoute = pathname === "/login";
  const isVeloAdminRoute = pathname.startsWith("/velo-admin");

  const sessionUser = useMemo(() => {
    const s = session as { user?: { email?: string | null; user_metadata?: Record<string, unknown> } } | null;
    return s?.user ?? null;
  }, [session]);

  const userEmail = sessionUser?.email ?? null;

  const displayName = useMemo(() => {
    const meta = sessionUser?.user_metadata;
    const full =
      meta && typeof meta.full_name === "string"
        ? meta.full_name.trim()
        : meta && typeof meta.name === "string"
          ? meta.name.trim()
          : "";
    if (full) return full;
    if (userEmail) return userEmail.split("@")[0] ?? "Merchant";
    return "Merchant";
  }, [sessionUser, userEmail]);

  const handleLogout = useCallback(async () => {
    try {
      await supabase?.auth.signOut();
    } finally {
      localStorage.removeItem("active_shop_id");
      localStorage.removeItem("active_shop_email");
      router.replace("/login");
    }
  }, [router]);

  useEffect(() => {
    if (!supabase) {
      setSession(null);
      setSessionLoading(false);
      return;
    }

    let mounted = true;

    async function loadSession() {
      try {
        if (!supabase) { setSession(null); return; }
        const res = await supabase.auth.getSession();
        if (!mounted) return;
        setSession(res?.data?.session ?? null);
      } finally {
        if (!mounted) return;
        setSessionLoading(false);
      }
    }

    setSessionLoading(true);
    loadSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!mounted) return;
      setSession(next ?? null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("admin-theme");
    if (stored === "light" || stored === "dark") {
      setTheme(stored);
      return;
    }
    setTheme("light");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("admin-notifications-enabled");
    setNotificationsEnabled(stored === "1");
  }, []);

  // Keep the Web Push subscription fresh when notifications are already enabled.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!notificationsEnabled) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const shopId = getActiveShopId();
    if (shopId) void subscribeToPush(shopId);
  }, [notificationsEnabled, session, sessionLoading]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    window.localStorage.setItem("admin-theme", theme);
  }, [theme]);

  const toggleNotifications = async () => {
    if (typeof window === "undefined") return;

    if (notificationsEnabled) {
      setNotificationsEnabled(false);
      window.localStorage.setItem("admin-notifications-enabled", "0");
      void unsubscribeFromPush();
      return;
    }

    if (!("Notification" in window)) {
      alert("Browser notifications are not supported in this browser.");
      return;
    }

    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      alert("Please allow notifications in your browser settings.");
      setNotificationsEnabled(false);
      window.localStorage.setItem("admin-notifications-enabled", "0");
      return;
    }

    setNotificationsEnabled(true);
    window.localStorage.setItem("admin-notifications-enabled", "1");

    // Register Web Push so alerts arrive even when the app is closed / phone is locked (iOS 16.4+).
    const shopId = getActiveShopId();
    if (shopId) void subscribeToPush(shopId);

    try {
      new Notification("Notifications enabled", {
        body: "You will get alerts for new orders and human handoff requests, even when the app is closed.",
      });
    } catch {
      // Some browsers require user gesture; ignore.
    }
  };

  const clearNotificationFeed = useCallback(() => {
    const shopId = getActiveShopId();
    notificationFeedSeenIdsRef.current = new Set();
    setNotificationFeed([]);
    setNotificationFeedUnread(0);
    if (shopId) saveAdminNotificationFeed(shopId, []);
  }, []);

  const markNotificationMenuSeen = useCallback(() => {
    setNotificationFeedUnread(0);
  }, []);

  // In-app notification feed (bell menu) + optional browser alerts when enabled.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (pathname.startsWith("/velo-admin")) return;
    if (!supabase) return;
    if (sessionLoading || !session) return;

    const shopId = getActiveShopId();
    if (!shopId) return;

    if (notificationFeedShopRef.current !== shopId) {
      notificationFeedShopRef.current = shopId;
      notificationFeedSeenIdsRef.current = new Set();
      const loaded = loadAdminNotificationFeed(shopId);
      for (const row of loaded) notificationFeedSeenIdsRef.current.add(row.id);
      setNotificationFeed(loaded);
      setNotificationFeedUnread(0);
    }

    const sb = supabase;

    const handoffPhrase = "activate";
    const dedupe = new Set<string>();
    const remember = (key: string) => {
      if (dedupe.has(key)) return false;
      dedupe.add(key);
      if (dedupe.size > 200) {
        const first = dedupe.values().next().value as string | undefined;
        if (first) dedupe.delete(first);
      }
      return true;
    };

    const pushFeedAndMaybeBrowser = (item: { id: string; title: string; body: string }) => {
      if (notificationFeedSeenIdsRef.current.has(item.id)) return;
      notificationFeedSeenIdsRef.current.add(item.id);

      const createdAt = new Date().toISOString();
      setNotificationFeed((prev) => {
        if (prev.some((x) => x.id === item.id)) return prev;
        const next = [{ id: item.id, title: item.title, body: item.body, createdAt }, ...prev].slice(
          0,
          30,
        );
        saveAdminNotificationFeed(shopId, next);
        return next;
      });
      queueMicrotask(() => setNotificationFeedUnread((u) => u + 1));

      if (
        notificationsEnabled &&
        typeof window !== "undefined" &&
        "Notification" in window &&
        Notification.permission === "granted"
      ) {
        try {
          new Notification(item.title, { body: item.body });
        } catch {
          // ignore
        }
      }
    };

    const ordersChannel = sb
      .channel(`notif:orders:${shopId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "orders",
          filter: `shop_id=eq.${shopId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          const id = String(row.id ?? "");
          if (id && !remember(`order:${id}`)) return;
          const product = String(row.product_name ?? "New order");
          const phone = String(row.customer_phone ?? "");
          const feedId = id ? `order:${id}` : `order:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          pushFeedAndMaybeBrowser({
            id: feedId,
            title: "New order",
            body: phone ? `${product} • ${phone}` : product,
          });
        },
      )
      .subscribe();

    const messagesChannel = sb
      .channel(`notif:handoff:${shopId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `shop_id=eq.${shopId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          const content = String(row.content ?? "").trim();
          const phone = String(row.phone_number ?? "");
          const id = String(row.id ?? "");

          // Order cancellation marker → notify admin
          if (content.includes("[ORDER_CANCELLED]")) {
            if (id && !remember(`cancel:${id}`)) return;
            const product = content.replace(/^\[ORDER_CANCELLED\]\s*Order cancelled by customer:\s*/i, "").trim();
            const feedId = id
              ? `cancel:${id}`
              : `cancel:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            pushFeedAndMaybeBrowser({
              id: feedId,
              title: "Order cancelled",
              body: product ? `${product}${phone ? ` • ${phone}` : ""}` : (phone ? `Customer: ${phone}` : "An order was cancelled"),
            });
            return;
          }

          if (!content.includes(handoffPhrase)) return;
          if (id && !remember(`handoff:${id}`)) return;
          const feedId = id
            ? `handoff:${id}`
            : `handoff:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          pushFeedAndMaybeBrowser({
            id: feedId,
            title: "Human help needed",
            body: phone ? `Customer: ${phone}` : "Open Messages",
          });
        },
      )
      .subscribe();

    const nowIso = new Date().toISOString();
    const lastOrderKey = `notif:lastOrderIso:${shopId}`;
    const lastHandoffKey = `notif:lastHandoffIso:${shopId}`;
    if (!window.localStorage.getItem(lastOrderKey)) {
      window.localStorage.setItem(lastOrderKey, nowIso);
    }
    if (!window.localStorage.getItem(lastHandoffKey)) {
      window.localStorage.setItem(lastHandoffKey, nowIso);
    }

    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      if (document.visibilityState !== "visible") return;

      const lastH = window.localStorage.getItem(lastHandoffKey) || nowIso;
      const handoffRes = await sb
        .from("messages")
        .select("id, phone_number, content, created_at")
        .eq("shop_id", shopId)
        .gt("created_at", lastH)
        .order("created_at", { ascending: true })
        .limit(25);
      if (!cancelled && handoffRes.data?.length) {
        const rows = handoffRes.data as unknown as Array<Record<string, unknown>>;
        for (const r of rows) {
          const content = String(r.content ?? "").trim();
          const id = String(r.id ?? "");
          const phone = String(r.phone_number ?? "");

          if (content.includes("[ORDER_CANCELLED]")) {
            if (id && !remember(`cancel:${id}`)) continue;
            const product = content.replace(/^\[ORDER_CANCELLED\]\s*Order cancelled by customer:\s*/i, "").trim();
            const feedId = id
              ? `cancel:${id}`
              : `cancel:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            pushFeedAndMaybeBrowser({
              id: feedId,
              title: "Order cancelled",
              body: product ? `${product}${phone ? ` • ${phone}` : ""}` : (phone ? `Customer: ${phone}` : "An order was cancelled"),
            });
            continue;
          }

          if (!content.includes(handoffPhrase)) continue;
          if (id && !remember(`handoff:${id}`)) continue;
          const feedId = id
            ? `handoff:${id}`
            : `handoff:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          pushFeedAndMaybeBrowser({
            id: feedId,
            title: "Human help needed",
            body: phone ? `Customer: ${phone}` : "Open Messages",
          });
        }
        const newest = String(rows[rows.length - 1].created_at ?? lastH);
        window.localStorage.setItem(lastHandoffKey, newest);
      }

      const lastO = window.localStorage.getItem(lastOrderKey) || nowIso;
      const ordersRes = await sb
        .from("orders")
        .select("id, customer_phone, product_name, created_at")
        .eq("shop_id", shopId)
        .gt("created_at", lastO)
        .order("created_at", { ascending: true })
        .limit(25);
      if (!cancelled && ordersRes.data?.length) {
        const rows = ordersRes.data as unknown as Array<Record<string, unknown>>;
        for (const r of rows) {
          const id = String(r.id ?? "");
          if (id && !remember(`order:${id}`)) continue;
          const product = String(r.product_name ?? "New order");
          const phone = String(r.customer_phone ?? "");
          const feedId = id ? `order:${id}` : `order:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          pushFeedAndMaybeBrowser({
            id: feedId,
            title: "New order",
            body: phone ? `${product} • ${phone}` : product,
          });
        }
        const newest = String(rows[rows.length - 1].created_at ?? lastO);
        window.localStorage.setItem(lastOrderKey, newest);
      }
    };

    const pollInterval = window.setInterval(() => void poll(), 5000);
    void poll();

    return () => {
      cancelled = true;
      window.clearInterval(pollInterval);
      sb.removeChannel(ordersChannel);
      sb.removeChannel(messagesChannel);
    };
  }, [pathname, supabase, session, sessionLoading, notificationsEnabled]);

  useEffect(() => {
    if (sessionLoading) return;
    if (!session && !isLoginRoute && !isVeloAdminRoute) router.replace("/login");
  }, [session, sessionLoading, isLoginRoute, isVeloAdminRoute, router]);

  useEffect(() => {
    if (pathname.startsWith("/velo-admin")) {
      setBillingOverlay(null);
      return;
    }
    if (sessionLoading || !session || isLoginRoute || !supabase) {
      setBillingOverlay(null);
      return;
    }

    const sb = supabase;

    const shopId = getActiveShopId();
    if (!shopId) {
      setBillingOverlay(null);
      return;
    }

    let cancelled = false;

    async function loadBilling() {
      const { data, error } = await sb
        .from("businesses")
        .select(
          "subscription_status, billing_next_due_at, billing_messages_used_period, billing_quota_hard_block",
        )
        .eq("id", shopId)
        .maybeSingle();

      if (cancelled) return;

      if (error || !data) {
        setBillingOverlay(null);
        return;
      }

      const row = data as Record<string, unknown>;
      // DEV TEST: check for test override in localStorage
      const testExpired = typeof window !== "undefined" && window.localStorage.getItem("test_billing_expired") === "1";
      const subscriptionStatus = testExpired ? "past_due" : String(row.subscription_status ?? "active");
      const nextDue = testExpired
        ? new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString()
        : (row.billing_next_due_at ? String(row.billing_next_due_at) : null);
      const quotaHardBlock = Boolean(row.billing_quota_hard_block);

      console.log("[DashboardShell] Billing check:", { shopId, subscriptionStatus, nextDue, quotaHardBlock });

      const blockMain = isPastDueBlocking({
        subscriptionStatus,
        billingNextDueAt: nextDue,
      });

      const paymentDueGrace = isPastDueInGrace({
        subscriptionStatus,
        billingNextDueAt: nextDue,
      });

      setBillingOverlay({
        blockMain,
        paymentDueGrace,
        nextDue,
        graceEndsIso: graceEndsAtIso(nextDue),
        quotaHardBlock,
        dueIn1Day: (() => {
          if (!nextDue || subscriptionStatus !== "active") return false;
          const due = new Date(nextDue);
          if (Number.isNaN(due.getTime())) return false;
          const diff = due.getTime() - Date.now();
          const hoursLeft = diff / (1000 * 60 * 60);
          return hoursLeft > 0 && hoursLeft <= 24;
        })(),
      });
    }

    void loadBilling();

    return () => {
      cancelled = true;
    };
  }, [session, sessionLoading, isLoginRoute, isVeloAdminRoute, pathname, supabase]);

  // Redirect blocked routes when expired
  const ALLOWED_WHEN_EXPIRED = ["/dashboard", "/orders", "/messages", "/settings"];
  const isBlockedRoute = (billingOverlay?.blockMain ?? false) &&
    !ALLOWED_WHEN_EXPIRED.some((r) => pathname === r || pathname.startsWith(r + "/"));

  useEffect(() => {
    if (isBlockedRoute) {
      router.replace("/dashboard");
    }
    // Only run when blockMain or pathname changes — NOT on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billingOverlay?.blockMain, pathname]);

  if (isLoginRoute || isVeloAdminRoute) {
    return (
      <div className="min-h-dvh bg-[var(--background)]">
        {children}
      </div>
    );
  }

  if (sessionLoading) {
    return (
      <div className="min-h-dvh bg-[var(--background)]">
        <div className="mx-auto w-full max-w-screen-2xl px-4 py-10 lg:px-8">
          <div className="h-8 w-48 animate-pulse rounded-xl bg-gray-200/80" />
          <div className="mt-6 h-64 w-full animate-pulse rounded-2xl bg-gray-200/50" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[var(--background)]">
      <div className="mx-auto flex h-dvh max-h-dvh min-h-0 w-full max-w-screen-2xl overflow-hidden">
        <Sidebar isExpired={billingOverlay?.blockMain ?? false} />
        <div data-main-content className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-0">
          <Topbar
            theme={theme}
            onToggleTheme={() =>
              setTheme((current) => (current === "light" ? "dark" : "light"))
            }
            notificationsEnabled={notificationsEnabled}
            onToggleNotifications={() => void toggleNotifications()}
            notificationFeed={notificationFeed}
            notificationUnreadCount={notificationFeedUnread}
            onNotificationMenuOpened={markNotificationMenuSeen}
            onClearNotificationFeed={clearNotificationFeed}
            displayName={displayName}
            userEmail={userEmail}
            onLogout={handleLogout}
          />
          {billingOverlay?.paymentDueGrace && !billingOverlay.blockMain ? (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-center text-sm text-amber-950">
              <span className="font-semibold">Payment due — contact support.</span>{" "}
              {billingOverlay.graceEndsIso
                ? `Grace period (${BILLING_GRACE_DAYS} days) ends ${new Date(billingOverlay.graceEndsIso).toLocaleString()}.`
                : null}
            </div>
          ) : null}
          {billingOverlay?.blockMain ? (
            <div className="border-b border-red-200 bg-red-50 px-4 py-2.5 text-center text-sm text-red-900">
              <span className="font-semibold">Payment overdue.</span> Dashboard actions are
              limited until your account is marked paid.{" "}
              <Link href="/settings" className="font-semibold underline">
                Open Settings
              </Link>
            </div>
          ) : null}
          {billingOverlay?.quotaHardBlock && !billingOverlay.blockMain ? (
            <div className="border-b border-orange-200 bg-orange-50 px-4 py-2.5 text-center text-sm text-orange-950">
              <span className="font-semibold">Message courtesy limit reached</span> for this
              billing period. Automated replies should pause until the next cycle or a plan
              upgrade — contact support.
            </div>
          ) : null}

          {/* 1-day renewal warning banner — only on dashboard */}
          {pathname === "/dashboard" && billingOverlay?.dueIn1Day && !billingOverlay.blockMain && !billingOverlay.paymentDueGrace ? (
            <div className="border-b border-amber-300 bg-amber-50 px-4 py-2.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-amber-900">
                <svg className="h-4 w-4 flex-shrink-0 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                <span><strong>Your subscription expires tomorrow.</strong> Renew now to avoid service interruption.</span>
              </div>
              <Link
                href="/settings"
                className="flex-shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 transition-colors"
              >
                Renew Now
              </Link>
            </div>
          ) : null}

          <main
            className={[
              "relative flex min-h-0 flex-1 flex-col animate-fade-in",
              isChatRoute ? "overflow-hidden p-0 lg:p-0" : "overflow-y-auto px-4 py-8 pb-24 lg:px-8 lg:pb-8",
              billingOverlay?.blockMain ? "pointer-events-none select-none opacity-[0.38]" : "",
            ].join(" ")}
          >
            {children}
            {billingOverlay?.blockMain ? (
              <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
                <div className="w-full max-w-sm rounded-2xl bg-[#1a1f35] border border-white/10 p-7 text-center shadow-2xl">
                  {/* Icon */}
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/15 border border-red-500/30">
                    <svg className="h-8 w-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3h10.5A2.25 2.25 0 0119.5 5.25v13.5A2.25 2.25 0 0117.25 21H6.75A2.25 2.25 0 014.5 18.75V5.25A2.25 2.25 0 016.75 3z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01" />
                    </svg>
                  </div>

                  {/* Title */}
                  <h2 className="mt-4 text-xl font-bold text-red-400">Subscription Expired</h2>
                  <p className="mt-2 text-sm text-white/70">
                    Your subscription has expired. Please renew to continue using the dashboard.
                  </p>

                  {/* Business info */}
                  {billingOverlay.nextDue && (
                    <div className="mt-4 rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm text-white/80">
                      <div>Due date: <span className="font-semibold text-white">{new Date(billingOverlay.nextDue).toLocaleDateString()}</span></div>
                    </div>
                  )}

                  <p className="mt-3 text-xs text-white/50">
                    Contact your administrator to renew your subscription.
                  </p>

                  {/* Buttons */}
                  <div className="mt-5 flex gap-2">
                    <a
                      href="https://wa.me/94760216497"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#25d366] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#20bd5a] transition-colors"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                        <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.553 4.122 1.522 5.864L0 24l6.293-1.49A11.936 11.936 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.891 0-3.663-.5-5.193-1.375l-.372-.222-3.873.917.976-3.773-.243-.389A9.96 9.96 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
                      </svg>
                      Contact Support
                    </a>
                    <button
                      type="button"
                      onClick={() => void handleLogout()}
                      className="flex-1 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-white/80 hover:bg-white/5 transition-colors"
                    >
                      Logout
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </main>
          <BottomNav />
        </div>
      </div>
    </div>
  );
}
