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

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    window.localStorage.setItem("admin-theme", theme);
  }, [theme]);

  const toggleNotifications = async () => {
    if (typeof window === "undefined") return;

    if (notificationsEnabled) {
      setNotificationsEnabled(false);
      window.localStorage.setItem("admin-notifications-enabled", "0");
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
    try {
      new Notification("Notifications enabled", {
        body: "You will get alerts for new orders and human handoff requests.",
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
          if (!content.includes(handoffPhrase)) return;
          const id = String(row.id ?? "");
          if (id && !remember(`handoff:${id}`)) return;
          const phone = String(row.phone_number ?? "");
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
          if (!content.includes(handoffPhrase)) continue;
          const id = String(r.id ?? "");
          if (id && !remember(`handoff:${id}`)) continue;
          const phone = String(r.phone_number ?? "");
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
      const subscriptionStatus = String(row.subscription_status ?? "active");
      const nextDue = row.billing_next_due_at
        ? String(row.billing_next_due_at)
        : null;
      const quotaHardBlock = Boolean(row.billing_quota_hard_block);

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
        <Sidebar />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-0">
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
              isChatRoute ? "overflow-hidden p-0 lg:p-0" : "overflow-y-auto px-4 py-8 lg:px-8",
              billingOverlay?.blockMain ? "pointer-events-none select-none opacity-[0.38]" : "",
            ].join(" ")}
          >
            {children}
            {billingOverlay?.blockMain ? (
              <div className="pointer-events-auto absolute inset-0 z-30 flex items-start justify-center bg-zinc-950/35 px-4 pt-16">
                <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-[var(--background)] p-6 text-center shadow-xl">
                  <p className="text-base font-semibold text-[var(--color-text-primary)]">
                    Payment required
                  </p>
                  <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
                    Your workspace is in read-only mode after the {BILLING_GRACE_DAYS}-day grace
                    window. Contact support to settle payment, then we will mark your account paid.
                  </p>
                  <Link
                    href="/settings"
                    className="mt-5 inline-flex rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
                  >
                    View billing in Settings
                  </Link>
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
