"use client";

import { useEffect, useState } from "react";
import {
  bufferExtraMessages,
  graceEndsAtIso,
  hardCapMessages,
  normalizePlanName,
  yearlyTotalLkr,
  PLAN_CONFIG,
  PLAN_ORDER,
} from "../../lib/billing";

type DbPlan = {
  id: string;
  display_name: string;
  description: string;
  monthly_price_lkr: number;
  included_messages: number;
  free_business_templates?: number;
  service_convo_cap?: number;
  features: string[];
};
import { supabase } from "../../lib/supabaseClient";
import { getActiveShopId } from "../../lib/activeShopId";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader } from "../../components/ui/card";

const menu = [
  "Store Profile",
  "WhatsApp Bot",
  "Notifications",
  "Billing",
] as const;

type MenuTab = (typeof menu)[number];

export default function SettingsPage() {
  const [activeMenu, setActiveMenu] = useState<MenuTab>(menu[0]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [storeName, setStoreName] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [currencyCode, setCurrencyCode] = useState("LKR");
  const [timeZone, setTimeZone] = useState("(GMT+05:30) Colombo");
  const [brandVoice, setBrandVoice] = useState("Friendly assistant speaking English and Singlish.");
  const [botEnabled, setBotEnabled] = useState(true);
  const [botAutoReply, setBotAutoReply] = useState(true);
  const [botEscalationMode, setBotEscalationMode] = useState("on_manual_handoff");
  const [notifOrderCreated, setNotifOrderCreated] = useState(true);
  const [notifOrderDelivered, setNotifOrderDelivered] = useState(true);
  const [notifLowStock, setNotifLowStock] = useState(true);
  const [billingPlan, setBillingPlan] = useState("Starter");
  const [billingCycle, setBillingCycle] = useState("Monthly");
  const [subscriptionStatus, setSubscriptionStatus] = useState("active");
  const [billingNextDueAt, setBillingNextDueAt] = useState<string | null>(null);
  const [billingMessagesUsed, setBillingMessagesUsed] = useState(0);
  const [billingQuotaHardBlock, setBillingQuotaHardBlock] = useState(false);
  const [billingLastMarkedPaidAt, setBillingLastMarkedPaidAt] = useState<string | null>(null);
  const [serviceConvos, setServiceConvos] = useState(0);
  const [businessConvos, setBusinessConvos] = useState(0);
  const [dbPlans, setDbPlans] = useState<DbPlan[]>([]);

  useEffect(() => {
    // Fetch plans from API
    void (async () => {
      try {
        const res = await fetch("/api/plans");
        const data = await res.json();
        if (res.ok && data.plans) setDbPlans(data.plans);
      } catch { /* use fallback PLAN_CONFIG */ }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      if (!supabase) {
        setError("Missing env vars: NEXT_PUBLIC_SUPABASE_URL and/or NEXT_PUBLIC_SUPABASE_ANON_KEY");
        setLoading(false);
        return;
      }

      const shopId = getActiveShopId();
      if (!shopId) {
        setError("No shop selected. Please login again.");
        setLoading(false);
        return;
      }

      const { data, error: fetchError } = await supabase
        .from("businesses")
        .select("*")
        .eq("id", shopId)
        .maybeSingle();

      if (cancelled) return;

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      const row = (data ?? {}) as Record<string, unknown>;
      setStoreName(String(row.business_name ?? ""));
      setSupportEmail(String(row.support_email ?? ""));
      setWhatsappNumber(String(row.whatsapp_number ?? ""));
      setCurrencyCode("LKR");
      setTimeZone(String(row.time_zone ?? "(GMT+05:30) Colombo"));
      setBrandVoice(String(row.brand_voice ?? "Friendly assistant speaking English and Singlish."));
      setBotEnabled(Boolean(row.bot_enabled ?? true));
      setBotAutoReply(Boolean(row.bot_auto_reply ?? true));
      setBotEscalationMode(String(row.bot_escalation_mode ?? "on_manual_handoff"));
      setNotifOrderCreated(Boolean(row.notif_order_created ?? true));
      setNotifOrderDelivered(Boolean(row.notif_order_delivered ?? true));
      setNotifLowStock(Boolean(row.notif_low_stock ?? true));
      setBillingPlan(String(row.billing_plan ?? "Starter"));
      setBillingCycle(String(row.billing_cycle ?? "Monthly"));
      setSubscriptionStatus(String(row.subscription_status ?? "active"));
      setBillingNextDueAt(
        row.billing_next_due_at != null ? String(row.billing_next_due_at) : null,
      );
      setBillingMessagesUsed(Number(row.billing_messages_used_period ?? 0));
      setBillingQuotaHardBlock(Boolean(row.billing_quota_hard_block ?? false));
      setServiceConvos(Number(row.billing_service_convos ?? 0));
      setBusinessConvos(Number(row.billing_business_convos ?? 0));
      setBillingLastMarkedPaidAt(
        row.billing_last_marked_paid_at != null
          ? String(row.billing_last_marked_paid_at)
          : null,
      );
      setLoading(false);
    }

    loadSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSave() {
    if (!supabase) return;
    const shopId = getActiveShopId();
    if (!shopId) {
      setError("No shop selected. Please login again.");
      return;
    }

    setError(null);
    setSuccess(null);
    setSaving(true);

    if (activeMenu === "Store Profile") {
      setSuccess("Store Profile is read-only for users.");
      setSaving(false);
      return;
    }

    if (activeMenu === "Billing") {
      setSuccess(
        "Billing is updated by our team after payment (mark paid). Message usage updates automatically from WhatsApp traffic.",
      );
      setSaving(false);
      return;
    }

    const payloadByTab: Record<MenuTab, Record<string, unknown>> = {
      "Store Profile": {},
      "WhatsApp Bot": {
        bot_enabled: botEnabled,
        bot_auto_reply: botAutoReply,
        bot_escalation_mode: botEscalationMode.trim() || "on_manual_handoff",
      },
      Notifications: {
        notif_order_created: notifOrderCreated,
        notif_order_delivered: notifOrderDelivered,
        notif_low_stock: notifLowStock,
      },
      Billing: {},
    };

    const { error: updateError } = await supabase
      .from("businesses")
      .update(payloadByTab[activeMenu])
      .eq("id", shopId);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    setSuccess(`${activeMenu} settings saved successfully.`);
    setSaving(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">
            Settings
          </h1>
          <p className="mt-1.5 text-sm text-gray-500">
            Manage your account and store preferences.
          </p>
        </div>
        <Button
          onClick={onSave}
          disabled={loading || saving || activeMenu === "Store Profile" || activeMenu === "Billing"}
          title={
            activeMenu === "Store Profile"
              ? "Store Profile is read-only"
              : activeMenu === "Billing"
                ? "Billing is managed by support after payment"
                : "Save current tab"
          }
        >
          {saving ? "Saving..." : "Save Changes"}
        </Button>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200/60 bg-red-50/80 px-4 py-3 text-sm text-red-700 shadow-sm">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-2xl border border-emerald-200/60 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-700 shadow-sm">
          {success}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-4">
        <Card className="h-fit lg:col-span-1">
          <CardContent className="space-y-2 p-3">
            {menu.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setActiveMenu(item)}
                className={[
                  "w-full rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-all duration-200",
                  activeMenu === item
                    ? "bg-gradient-to-r from-indigo-50/80 to-violet-50/50 text-indigo-700 ring-1 ring-inset ring-indigo-100/50 shadow-sm"
                    : "text-gray-500 hover:bg-gray-50 hover:text-gray-800",
                ].join(" ")}
              >
                {item}
              </button>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <h2 className="text-xl font-semibold text-zinc-900">{activeMenu}</h2>
          </CardHeader>
          <CardContent className="space-y-8">
            {activeMenu === "Store Profile" ? (
              <>
                <div className="rounded-xl border border-amber-200/60 bg-amber-50/80 px-4 py-3 text-sm text-amber-800 shadow-sm">
                  Store profile is managed centrally and cannot be edited by users here.
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <ReadonlyField label="Store Name" value={storeName} />
                  <ReadonlyField label="Support Email" value={supportEmail} />
                  <ReadonlyField label="WhatsApp Business Number" value={whatsappNumber} />
                  <ReadonlyField label="Currency" value={currencyCode} />
                  <ReadonlyField label="Time Zone" value={timeZone} />
                </div>
              </>
            ) : null}

            {activeMenu === "WhatsApp Bot" ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-amber-200/60 bg-amber-50/80 px-4 py-3 text-sm text-amber-800 shadow-sm">
                  Brand Voice is managed by the admin team and cannot be edited by clients.
                </div>
                <ToggleField
                  label="Bot Enabled"
                  checked={botEnabled}
                  onChange={setBotEnabled}
                  disabled={loading || saving}
                />
                <ToggleField
                  label="Auto Reply"
                  checked={botAutoReply}
                  onChange={setBotAutoReply}
                  disabled={loading || saving || !botEnabled}
                />
                <Field
                  label="Escalation Mode"
                  value={botEscalationMode}
                  onChange={setBotEscalationMode}
                  disabled={loading || saving || !botEnabled}
                />
                <Field
                  label="Brand Voice"
                  value={brandVoice}
                  onChange={setBrandVoice}
                  disabled
                />
              </div>
            ) : null}

            {activeMenu === "Notifications" ? (
              <div className="space-y-4">
                <ToggleField
                  label="Notify on New Order"
                  checked={notifOrderCreated}
                  onChange={setNotifOrderCreated}
                  disabled={loading || saving}
                />
                <ToggleField
                  label="Notify on Delivered Order"
                  checked={notifOrderDelivered}
                  onChange={setNotifOrderDelivered}
                  disabled={loading || saving}
                />
                <ToggleField
                  label="Notify on Low Stock"
                  checked={notifLowStock}
                  onChange={setNotifLowStock}
                  disabled={loading || saving}
                />
                <div className="rounded-xl border px-4 py-3 text-xs" style={{ borderColor: 'var(--color-border-card)', background: 'var(--color-surface-secondary)', color: 'var(--color-text-secondary)' }}>
                  These notification preferences are saved and working. They currently control
                  app-level notification settings stored in your database. If you want, I can next
                  wire them to real channels (email/WhatsApp/push) event-by-event.
                </div>
              </div>
            ) : null}

            {activeMenu === "Billing" ? (
              <BillingSettingsView
                loading={loading}
                billingPlan={billingPlan}
                billingCycle={billingCycle}
                subscriptionStatus={subscriptionStatus}
                billingNextDueAt={billingNextDueAt}
                billingMessagesUsed={billingMessagesUsed}
                billingQuotaHardBlock={billingQuotaHardBlock}
                billingLastMarkedPaidAt={billingLastMarkedPaidAt}
                dbPlans={dbPlans}
                serviceConvos={serviceConvos}
                businessConvos={businessConvos}
              />
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function BillingSettingsView({
  loading,
  billingPlan,
  billingCycle,
  subscriptionStatus,
  billingNextDueAt,
  billingMessagesUsed,
  billingQuotaHardBlock,
  billingLastMarkedPaidAt,
  dbPlans,
  serviceConvos,
  businessConvos,
}: {
  loading: boolean;
  billingPlan: string;
  billingCycle: string;
  subscriptionStatus: string;
  billingNextDueAt: string | null;
  billingMessagesUsed: number;
  billingQuotaHardBlock: boolean;
  billingLastMarkedPaidAt: string | null;
  dbPlans: DbPlan[];
  serviceConvos: number;
  businessConvos: number;
}) {
  const planName = normalizePlanName(billingPlan);

  // Use dynamic plans from DB, fall back to hardcoded
  const activePlanDb = dbPlans.find((p) => p.id === planName);
  const included = activePlanDb?.included_messages ?? PLAN_CONFIG[planName].includedMessages;
  const bufferExtra = bufferExtraMessages(included);
  const hardCap = hardCapMessages(included);

  // Conversation billing
  const FREE_SERVICE_LIMIT = 1000;
  const SERVICE_OVERAGE_RATE = 9; // Rs. per extra service conversation
  const BUSINESS_CONVO_RATE = 16; // Rs. per business-initiated conversation
  const serviceOverage = Math.max(0, serviceConvos - FREE_SERVICE_LIMIT);
  const serviceOverageCost = serviceOverage * SERVICE_OVERAGE_RATE;
  const businessConvoCost = businessConvos * BUSINESS_CONVO_RATE;
  const totalOverageCost = serviceOverageCost + businessConvoCost;

  // Live message count: count actual inbound messages from the messages table
  const [liveUsed, setLiveUsed] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchLiveUsage = async () => {
    if (!supabase) return;
    const shopId = getActiveShopId();
    if (!shopId) return;
    setRefreshing(true);

    // Count ALL messages for this shop in the current billing period
    // The admin panel counts all messages (inbound + outbound), so we match that
    const periodStart = billingLastMarkedPaidAt;
    let query = supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId);

    if (periodStart) {
      query = query.gte("created_at", periodStart);
    }

    const { count, error: countErr } = await query;

    if (!countErr && count !== null && count > 0) {
      setLiveUsed(count);
    } else {
      // If message count fails, try the billing field from businesses table
      const { data: bizData } = await supabase
        .from("businesses")
        .select("billing_messages_used_period")
        .eq("id", shopId)
        .maybeSingle();

      const dbVal = (bizData as Record<string, unknown> | null)?.billing_messages_used_period;
      if (typeof dbVal === "number" && dbVal > 0) {
        setLiveUsed(dbVal);
      } else {
        // Last resort: count ALL messages for this shop (no period filter)
        const { count: totalCount } = await supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("shop_id", shopId);

        setLiveUsed(totalCount ?? 0);
      }
    }
    setRefreshing(false);
  };

  useEffect(() => {
    void fetchLiveUsage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billingMessagesUsed, billingLastMarkedPaidAt]);

  const used = Math.max(0, liveUsed ?? billingMessagesUsed);
  const messagesLeft = Math.max(0, hardCap - used);
  const pctTowardHard = hardCap > 0 ? Math.min(100, (used / hardCap) * 100) : 0;
  const graceEnd = graceEndsAtIso(billingNextDueAt);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border px-4 py-3 text-sm" style={{ borderColor: 'var(--color-border-card)', background: 'var(--color-surface-secondary)', color: 'var(--color-text-secondary)' }}>
        Your plan and renewal dates are set when we <span className="font-semibold">mark your
        account paid</span>. Yearly billing charges <span className="font-semibold">10 months</span>{" "}
        of the monthly price (two months free). Each plan includes inbound message volume per
        period, plus a <span className="font-semibold">20% courtesy buffer</span> before automated
        replies should pause — you get a WhatsApp heads-up when you hit 100% of the included
        amount.
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border px-4 py-3" style={{ borderColor: 'var(--color-border-card)', background: 'var(--color-surface-solid)' }}>
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>
            Subscription status
          </div>
          <div className="mt-1 text-sm font-semibold capitalize" style={{ color: 'var(--color-text-primary)' }}>
            {loading ? "…" : subscriptionStatus.replace(/_/g, " ")}
          </div>
        </div>
        <div className="rounded-xl border px-4 py-3" style={{ borderColor: 'var(--color-border-card)', background: 'var(--color-surface-solid)' }}>
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>
            Next payment due
          </div>
          <div className="mt-1 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {loading
              ? "…"
              : billingNextDueAt
                ? (() => {
                    const due = new Date(billingNextDueAt);
                    const diff = due.getTime() - Date.now();
                    const days = Math.ceil(diff / (24 * 60 * 60 * 1000));
                    if (days < 0) return `${Math.abs(days)} day${Math.abs(days) !== 1 ? "s" : ""} overdue`;
                    if (days === 0) return "Due today";
                    if (days === 1) return "1 day remaining";
                    return `${days} days remaining`;
                  })()
                : "— (set after first mark paid)"}
          </div>
          {subscriptionStatus === "past_due" && graceEnd ? (
            <div className="mt-1 text-xs text-amber-700">
              Grace window ends {new Date(graceEnd).toLocaleString()}.
            </div>
          ) : null}
        </div>
      </div>

      {billingLastMarkedPaidAt ? (
        <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          Last marked paid: {new Date(billingLastMarkedPaidAt).toLocaleString()}
        </div>
      ) : null}

      {/* Conversation Usage & Costs */}
      <div className="mt-4 rounded-xl border px-4 py-4" style={{ borderColor: 'var(--color-border-card)', background: 'var(--color-surface-solid)' }}>
        <div className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>WhatsApp Conversation Usage</div>
        <p className="mt-1 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          First 1,000 customer-initiated conversations/month are free. Business-initiated (templates/broadcasts) are charged per conversation.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border px-3 py-2.5" style={{ borderColor: 'var(--color-border-card)' }}>
            <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>Service Conversations</div>
            <div className="mt-1 text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>{serviceConvos.toLocaleString()} / {FREE_SERVICE_LIMIT.toLocaleString()}</div>
            <div className="mt-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-secondary)' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, (serviceConvos / FREE_SERVICE_LIMIT) * 100)}%`, background: serviceConvos > FREE_SERVICE_LIMIT ? '#ef4444' : 'var(--color-accent)' }} />
            </div>
            {serviceOverage > 0 && (
              <div className="mt-1 text-xs text-red-600 font-medium">
                +{serviceOverage} over free tier = LKR {serviceOverageCost.toLocaleString()} (Rs.{SERVICE_OVERAGE_RATE}/each)
              </div>
            )}
          </div>
          <div className="rounded-lg border px-3 py-2.5" style={{ borderColor: 'var(--color-border-card)' }}>
            <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>Business-Initiated (Templates)</div>
            <div className="mt-1 text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>{businessConvos.toLocaleString()}</div>
            <div className="mt-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              Rs.{BUSINESS_CONVO_RATE}/conversation = LKR {businessConvoCost.toLocaleString()}
            </div>
          </div>
        </div>

        {totalOverageCost > 0 && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
            <span className="font-semibold text-amber-800">Extra charges this period:</span>{" "}
            <span className="font-bold text-amber-900">LKR {totalOverageCost.toLocaleString()}</span>
            <span className="text-xs text-amber-700 ml-1">(added to your subscription)</span>
          </div>
        )}
      </div>

      <div>
        <div className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>Your plan</div>
        <p className="mt-1 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          Highlighted card matches your active subscription tier (managed by support).
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {(dbPlans.length > 0 ? dbPlans : PLAN_ORDER.map((key) => ({ id: key, display_name: key, description: PLAN_CONFIG[key].description, monthly_price_lkr: PLAN_CONFIG[key].monthlyPriceLkr, included_messages: PLAN_CONFIG[key].includedMessages, features: [] }))).map((p) => {
            const active = planName === p.id;
            const monthly = p.monthly_price_lkr.toLocaleString();
            const yearly = yearlyTotalLkr(p.monthly_price_lkr).toLocaleString();
            return (
              <div
                key={p.id}
                className={[
                  "rounded-2xl border p-4 text-left transition-all",
                  active ? "ring-2" : "opacity-90",
                ].join(" ")}
                style={{
                  borderColor: active ? 'var(--color-accent)' : 'var(--color-border-card)',
                  background: active ? 'var(--color-accent-light)' : 'var(--color-surface-solid)',
                  ...(active ? { '--tw-ring-color': 'var(--color-accent-glow)' } as React.CSSProperties : {}),
                }}
              >
                <div className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{p.display_name}</div>
                <div className="mt-1 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{p.description}</div>
                <div className="mt-2 space-y-0.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  <div>✓ {p.included_messages.toLocaleString()} AI msgs / period + 20% courtesy</div>
                  <div>✓ {(p as DbPlan).free_business_templates ?? 25} free templates / month</div>
                  <div>✓ {((p as DbPlan).service_convo_cap ?? 1000).toLocaleString()} service convos cap</div>
                </div>
                <div className="mt-3 text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  LKR {monthly} / mo
                </div>
                <div className="mt-1 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                  Yearly: LKR {yearly}/yr (10× monthly, save 2 months)
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border px-4 py-3" style={{ borderColor: 'var(--color-border-card)', background: 'var(--color-surface-solid)' }}>
        <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>
          Billing cycle on file
        </div>
        <div className="mt-1 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{billingCycle}</div>
      </div>

      <div className="rounded-xl border px-4 py-4" style={{ borderColor: 'var(--color-border-card)', background: 'var(--color-surface-solid)' }}>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <div className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>Message usage (this period)</div>
              <button
                type="button"
                onClick={() => void fetchLiveUsage()}
                disabled={refreshing}
                className="text-xs font-medium disabled:opacity-50"
                style={{ color: 'var(--color-accent)' }}
                title="Refresh usage data"
              >
                {refreshing ? "Refreshing…" : "↻ Refresh"}
              </button>
            </div>
            <div className="mt-1 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              Included {included.toLocaleString()} + courtesy {bufferExtra.toLocaleString()} = hard
              cap {hardCap.toLocaleString()}
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
              {messagesLeft.toLocaleString()}
            </div>
            <div className="text-xs font-medium" style={{ color: 'var(--color-text-tertiary)' }}>messages left (to hard cap)</div>
          </div>
        </div>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full" style={{ background: 'var(--color-surface-secondary)' }}>
          <div
            className={[
              "h-full rounded-full transition-all duration-500",
              billingQuotaHardBlock
                ? "bg-red-500"
                : pctTowardHard > 80
                  ? "bg-amber-500"
                  : "bg-blue-500",
            ].join(" ")}
            style={{ width: `${pctTowardHard}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          <span>Used {used.toLocaleString()}</span>
          <span>Cap {hardCap.toLocaleString()}</span>
        </div>
        {billingQuotaHardBlock ? (
          <div className="mt-3 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--color-danger)', background: 'var(--color-danger-light)', color: 'var(--color-danger)' }}>
            Courtesy limit reached for this period. Contact support to upgrade or renew.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="h-11 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm font-medium text-zinc-900">
        {value || "—"}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="h-11 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm font-medium text-zinc-900 outline-none focus:border-zinc-400 disabled:bg-zinc-100"
      />
    </div>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm">
      <span className="font-medium text-zinc-800">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
    </label>
  );
}

