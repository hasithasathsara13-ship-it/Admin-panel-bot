"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

type BusinessDetail = {
  id: string;
  business_name: string | null;
  support_email: string | null;
  whatsapp_number: string | null;
  business_category: string | null;
  brand_voice: string | null;
  meta_phone_id: string | null;
  meta_api_token: string | null;
  waba_id: string | null;
  bot_mode: string | null;
  bot_enabled: boolean | null;
  enable_ordering: boolean | null;
  enable_reviews: boolean | null;
  billing_plan: string | null;
  billing_cycle: string | null;
  subscription_status: string | null;
  billing_next_due_at: string | null;
  billing_messages_used_period: number | null;
  billing_quota_hard_block: boolean | null;
  billing_last_marked_paid_at: string | null;
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

export default function BusinessDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [biz, setBiz] = useState<BusinessDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Editable fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [category, setCategory] = useState("");
  const [brandVoice, setBrandVoice] = useState("");
  const [metaPhoneId, setMetaPhoneId] = useState("");
  const [metaApiToken, setMetaApiToken] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [plan, setPlan] = useState("Starter");
  const [cycle, setCycle] = useState("Monthly");
  const [status, setStatus] = useState("active");
  // Bot control
  const [botMode, setBotMode] = useState("full_ecommerce");
  const [botEnabled, setBotEnabled] = useState(true);
  const [enableOrdering, setEnableOrdering] = useState(true);
  const [enableReviews, setEnableReviews] = useState(false);

  const loadBusiness = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/velo-admin/businesses", { credentials: "include" });
    if (res.status === 401) {
      router.replace("/login?next=/velo-admin/businesses");
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { businesses?: BusinessDetail[] };
    const found = data.businesses?.find((b) => b.id === id);
    if (!found) {
      setError("Business not found.");
      setLoading(false);
      return;
    }
    setBiz(found);
    setName(found.business_name || "");
    setEmail(found.support_email || "");
    setPhone(found.whatsapp_number || "");
    setCategory(found.business_category || "");
    setBrandVoice(found.brand_voice || "");
    setMetaPhoneId(found.meta_phone_id || "");
    setMetaApiToken(found.meta_api_token || "");
    setWabaId(found.waba_id || "");
    setPlan(found.billing_plan || "Starter");
    setCycle(found.billing_cycle || "Monthly");
    setStatus(found.subscription_status || "active");
    setBotMode(found.bot_mode || "full_ecommerce");
    setBotEnabled(found.bot_enabled !== false);
    setEnableOrdering(found.enable_ordering !== false);
    setEnableReviews(found.enable_reviews === true);
    setLoading(false);
  }, [id, router]);

  useEffect(() => {
    void loadBusiness();
  }, [loadBusiness]);

  async function saveChanges() {
    setSaving(true);
    setError(null);
    setSuccess(null);

    const res = await fetch("/api/velo-admin/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        shop_id: id,
        brand_voice: brandVoice || null,
        waba_id: wabaId || null,
        meta_api_token: metaApiToken || null,
        meta_phone_id: metaPhoneId || null,
        bot_mode: botMode,
        bot_enabled: botEnabled,
        enable_ordering: enableOrdering,
        enable_reviews: enableReviews,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setSaving(false);

    if (!res.ok) {
      setError(data.error || "Failed to save");
    } else {
      setSuccess("Changes saved successfully.");
      setTimeout(() => setSuccess(null), 3000);
    }
  }

  async function markPaid() {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/velo-admin/mark-paid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ shop_id: id }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setSaving(false);
    if (!res.ok) {
      setError(data.error || "Mark paid failed");
    } else {
      setSuccess("Marked as paid!");
      await loadBusiness();
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-white/70">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          Loading business…
        </div>
      </div>
    );
  }

  if (!biz) {
    return (
      <div className="text-center py-20">
        <p className="text-white/70">{error || "Business not found."}</p>
        <Link href="/velo-admin/businesses" className="mt-3 inline-block text-indigo-400 text-sm hover:underline">
          ← Back to businesses
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/30 to-violet-500/20 text-lg font-bold text-indigo-100 ring-1 ring-inset ring-white/10">
            {(biz.business_name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
          </div>
          <div className="min-w-0">
            <Link href="/velo-admin/businesses" className="text-xs text-indigo-400 hover:underline">
              ← Back to businesses
            </Link>
            <h1 className="mt-0.5 text-2xl font-bold text-white truncate">{biz.business_name || "Untitled"}</h1>
            <p className="text-xs text-white/40 font-mono">{biz.id}</p>
          </div>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => void markPaid()}
            disabled={saving}
            className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-emerald-500/20 hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            Mark Paid
          </button>
          <button
            type="button"
            onClick={() => void saveChanges()}
            disabled={saving}
            className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-indigo-500/20 hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
      )}
      {success && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</div>
      )}

      {/* Status Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-white/10 bg-[#0c101c]/80 px-4 py-3 text-center">
          <div className="text-[10px] uppercase tracking-wide text-white/50">Status</div>
          <div className={["mt-1 text-sm font-bold capitalize", status === "active" ? "text-emerald-400" : status === "past_due" ? "text-amber-400" : "text-red-400"].join(" ")}>
            {status.replace("_", " ")}
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#0c101c]/80 px-4 py-3 text-center">
          <div className="text-[10px] uppercase tracking-wide text-white/50">Plan</div>
          <div className="mt-1 text-sm font-bold text-white">{plan} · {cycle}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#0c101c]/80 px-4 py-3 text-center">
          <div className="text-[10px] uppercase tracking-wide text-white/50">Next Due</div>
          <div className="mt-1 text-sm font-bold text-white">{daysLeft(biz.billing_next_due_at)}</div>
        </div>
        <Link href="/velo-admin/billing" className="rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-3 text-center hover:bg-indigo-500/20 transition">
          <div className="text-[10px] uppercase tracking-wide text-indigo-200/70">Billing</div>
          <div className="mt-1 text-sm font-bold text-indigo-200">Manage →</div>
        </Link>
      </div>

      {/* Business Info */}
      <section className="rounded-2xl border border-white/10 bg-[#0c101c]/80 p-5">
        <h2 className="text-sm font-semibold text-white mb-4">Business Information</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-[11px] font-medium text-white/60">Business Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="velo-admin-input w-full rounded-lg border border-white/10 px-3 py-2 text-sm outline-none focus:border-indigo-500/50" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[11px] font-medium text-white/60">Email</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} className="velo-admin-input w-full rounded-lg border border-white/10 px-3 py-2 text-sm outline-none focus:border-indigo-500/50" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[11px] font-medium text-white/60">WhatsApp Number</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className="velo-admin-input w-full rounded-lg border border-white/10 px-3 py-2 text-sm outline-none focus:border-indigo-500/50" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[11px] font-medium text-white/60">Category</span>
            <input value={category} onChange={(e) => setCategory(e.target.value)} className="velo-admin-input w-full rounded-lg border border-white/10 px-3 py-2 text-sm outline-none focus:border-indigo-500/50" />
          </label>
        </div>
      </section>

      {/* Bot Control */}
      <section className="rounded-2xl border border-white/10 bg-[#0c101c]/80 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-white">🤖 AI Bot Control</h2>
            <p className="text-[11px] text-white/50 mt-0.5">Control how the WhatsApp AI behaves for this business.</p>
          </div>
          {/* Master toggle */}
          <button
            type="button"
            onClick={() => setBotEnabled((v) => !v)}
            className={[
              "relative inline-flex h-7 w-12 items-center rounded-full transition-colors",
              botEnabled ? "bg-emerald-500" : "bg-white/20",
            ].join(" ")}
            aria-label="Toggle bot"
          >
            <span className={["inline-block h-5 w-5 transform rounded-full bg-white transition-transform", botEnabled ? "translate-x-6" : "translate-x-1"].join(" ")} />
          </button>
        </div>

        {!botEnabled && (
          <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            Bot is OFF — the AI will not reply to any customer messages for this business.
          </div>
        )}

        {/* Bot mode selection */}
        <div className="space-y-3">
          <span className="text-[11px] font-medium uppercase tracking-wide text-white/60">Bot Mode</span>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { key: "full_ecommerce", icon: "🛒", title: "Full E-Commerce", desc: "Orders, sizing, checkout, inventory & order tags active." },
              { key: "reviews_only", icon: "⭐", title: "Reviews Only", desc: "Uses customer reviews as social proof. Directs orders out of chat." },
              { key: "info_only", icon: "ℹ️", title: "Info Only", desc: "Strictly informational. No ordering or checkout." },
            ].map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => {
                  setBotMode(m.key);
                  if (m.key === "full_ecommerce") setEnableOrdering(true);
                  if (m.key === "info_only") setEnableOrdering(false);
                  if (m.key === "reviews_only") { setEnableOrdering(false); setEnableReviews(true); }
                }}
                className={[
                  "rounded-xl border p-3 text-left transition-all",
                  botMode === m.key
                    ? "border-indigo-500/50 bg-indigo-500/15 ring-1 ring-inset ring-indigo-500/30"
                    : "border-white/10 bg-white/[0.02] hover:border-white/20",
                ].join(" ")}
              >
                <div className="text-lg">{m.icon}</div>
                <div className="mt-1 text-sm font-semibold text-white">{m.title}</div>
                <div className="mt-0.5 text-[11px] text-white/50 leading-snug">{m.desc}</div>
              </button>
            ))}
          </div>

          {/* Feature toggles */}
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5">
              <span className="text-xs text-white/80">Enable Ordering / Checkout</span>
              <input
                type="checkbox"
                checked={enableOrdering}
                onChange={(e) => setEnableOrdering(e.target.checked)}
                className="h-4 w-4 rounded accent-indigo-500"
              />
            </label>
            <label className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5">
              <span className="text-xs text-white/80">Enable Reviews (social proof)</span>
              <input
                type="checkbox"
                checked={enableReviews}
                onChange={(e) => setEnableReviews(e.target.checked)}
                className="h-4 w-4 rounded accent-indigo-500"
              />
            </label>
          </div>
        </div>
      </section>

      {/* Meta Configuration */}
      <section className="rounded-2xl border border-white/10 bg-[#0c101c]/80 p-5">
        <h2 className="text-sm font-semibold text-white mb-1">WhatsApp API Configuration</h2>
        <p className="text-[11px] text-white/50 mb-4">Meta Business Manager credentials for this business.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-[11px] font-medium text-white/60">Phone Number ID</span>
            <input value={metaPhoneId} onChange={(e) => setMetaPhoneId(e.target.value)} className="velo-admin-input w-full rounded-lg border border-white/10 px-3 py-2 text-sm font-mono outline-none focus:border-indigo-500/50" placeholder="Not set" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[11px] font-medium text-white/60">WABA ID</span>
            <input value={wabaId} onChange={(e) => setWabaId(e.target.value)} className="velo-admin-input w-full rounded-lg border border-white/10 px-3 py-2 text-sm font-mono outline-none focus:border-indigo-500/50" placeholder="Not set" />
          </label>
          <label className="block space-y-1.5 sm:col-span-2">
            <span className="text-[11px] font-medium text-white/60">Meta API Token</span>
            <input type="password" value={metaApiToken} onChange={(e) => setMetaApiToken(e.target.value)} className="velo-admin-input w-full rounded-lg border border-white/10 px-3 py-2 text-sm font-mono outline-none focus:border-indigo-500/50" placeholder="Not set" />
          </label>
        </div>
      </section>

      {/* Brand Voice */}
      <section className="rounded-2xl border border-white/10 bg-[#0c101c]/80 p-5">
        <h2 className="text-sm font-semibold text-white mb-1">Brand Voice</h2>
        <p className="text-[11px] text-white/50 mb-4">AI personality for this workspace.</p>
        <textarea
          value={brandVoice}
          onChange={(e) => setBrandVoice(e.target.value)}
          rows={16}
          maxLength={12000}
          className="velo-admin-input w-full min-h-[400px] rounded-lg border border-white/10 px-3 py-2.5 text-sm leading-relaxed outline-none focus:border-indigo-500/50 resize-y"
          placeholder="Friendly assistant speaking English and Singlish."
        />
      </section>

      {/* Meta info */}
      <div className="text-[11px] text-white/40 space-y-0.5">
        <p>Created: {biz.created_at ? new Date(biz.created_at).toLocaleString() : "—"}</p>
        <p>Last marked paid: {biz.billing_last_marked_paid_at ? new Date(biz.billing_last_marked_paid_at).toLocaleString() : "Never"}</p>
        <p>Quota hard block: {biz.billing_quota_hard_block ? "Yes" : "No"}</p>
      </div>
    </div>
  );
}
