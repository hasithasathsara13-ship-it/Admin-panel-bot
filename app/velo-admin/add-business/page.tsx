"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

const DEFAULT_BRAND_VOICE = "Friendly assistant speaking English and Singlish.";

export default function AddBusinessPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    business_name: "",
    support_email: "",
    whatsapp_number: "",
    business_category: "",
    brand_voice: "",
    meta_phone_id: "",
    meta_api_token: "",
    waba_id: "",
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.business_name.trim()) {
      setError("Business name is required.");
      return;
    }
    setBusy(true);
    setError(null);

    const payload: Record<string, string | null> = { business_name: form.business_name.trim() };
    if (form.support_email.trim()) payload.support_email = form.support_email.trim();
    if (form.whatsapp_number.trim()) payload.whatsapp_number = form.whatsapp_number.trim();
    if (form.business_category.trim()) payload.business_category = form.business_category.trim();
    if (form.brand_voice.trim()) payload.brand_voice = form.brand_voice.trim();
    if (form.meta_phone_id.trim()) payload.meta_phone_id = form.meta_phone_id.trim();
    if (form.meta_api_token.trim()) payload.meta_api_token = form.meta_api_token.trim();
    if (form.waba_id.trim()) payload.waba_id = form.waba_id.trim();

    const res = await fetch("/api/velo-admin/businesses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);

    if (!res.ok) {
      setError(data.error || "Could not create business");
      return;
    }

    router.push("/velo-admin/businesses");
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-white">Add Business</h1>
      <p className="mt-1 text-sm text-white/70">Create a new workspace with WhatsApp configuration.</p>

      {error && (
        <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      <form onSubmit={(e) => void onSubmit(e)} className="mt-6 space-y-6">
        {/* Basic Info */}
        <section className="rounded-2xl border border-white/10 bg-[#0c101c]/80 p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Business Details</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-white/70">Business Name *</span>
              <input
                required
                value={form.business_name}
                onChange={(e) => setForm((f) => ({ ...f, business_name: e.target.value }))}
                className="velo-admin-input w-full rounded-lg border border-white/10 px-3 py-2.5 text-sm outline-none focus:border-indigo-500/50"
                placeholder="Acme Store"
                disabled={busy}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-white/70">Support Email</span>
              <input
                type="email"
                value={form.support_email}
                onChange={(e) => setForm((f) => ({ ...f, support_email: e.target.value }))}
                className="velo-admin-input w-full rounded-lg border border-white/10 px-3 py-2.5 text-sm outline-none focus:border-indigo-500/50"
                placeholder="owner@example.com"
                disabled={busy}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-white/70">WhatsApp Number</span>
              <input
                value={form.whatsapp_number}
                onChange={(e) => setForm((f) => ({ ...f, whatsapp_number: e.target.value }))}
                className="velo-admin-input w-full rounded-lg border border-white/10 px-3 py-2.5 text-sm outline-none focus:border-indigo-500/50"
                placeholder="+94771234567"
                disabled={busy}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-white/70">Category</span>
              <input
                value={form.business_category}
                onChange={(e) => setForm((f) => ({ ...f, business_category: e.target.value }))}
                className="velo-admin-input w-full rounded-lg border border-white/10 px-3 py-2.5 text-sm outline-none focus:border-indigo-500/50"
                placeholder="Retail, services…"
                disabled={busy}
              />
            </label>
          </div>
        </section>

        {/* Meta Configuration */}
        <section className="rounded-2xl border border-white/10 bg-[#0c101c]/80 p-5">
          <h2 className="text-sm font-semibold text-white mb-1">WhatsApp API Configuration</h2>
          <p className="text-[11px] text-white/50 mb-4">
            Found in Meta Business Manager → WhatsApp → API Setup. Required for sending messages.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-white/70">Phone Number ID</span>
              <input
                value={form.meta_phone_id}
                onChange={(e) => setForm((f) => ({ ...f, meta_phone_id: e.target.value }))}
                className="velo-admin-input w-full rounded-lg border border-white/10 px-3 py-2.5 text-sm font-mono outline-none focus:border-indigo-500/50"
                placeholder="1038798209321900"
                disabled={busy}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-white/70">WABA ID</span>
              <input
                value={form.waba_id}
                onChange={(e) => setForm((f) => ({ ...f, waba_id: e.target.value }))}
                className="velo-admin-input w-full rounded-lg border border-white/10 px-3 py-2.5 text-sm font-mono outline-none focus:border-indigo-500/50"
                placeholder="24341998712164373"
                disabled={busy}
              />
            </label>
            <label className="block space-y-1.5 sm:col-span-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-white/70">Meta API Token</span>
              <input
                type="password"
                value={form.meta_api_token}
                onChange={(e) => setForm((f) => ({ ...f, meta_api_token: e.target.value }))}
                className="velo-admin-input w-full rounded-lg border border-white/10 px-3 py-2.5 text-sm font-mono outline-none focus:border-indigo-500/50"
                placeholder="EAAc5Hsx..."
                disabled={busy}
              />
            </label>
          </div>
        </section>

        {/* Brand Voice */}
        <section className="rounded-2xl border border-white/10 bg-[#0c101c]/80 p-5">
          <h2 className="text-sm font-semibold text-white mb-1">Brand Voice</h2>
          <p className="text-[11px] text-white/50 mb-4">How the AI assistant should sound for this business.</p>
          <textarea
            value={form.brand_voice}
            onChange={(e) => setForm((f) => ({ ...f, brand_voice: e.target.value }))}
            rows={4}
            maxLength={12000}
            className="velo-admin-input w-full rounded-lg border border-white/10 px-3 py-2.5 text-sm outline-none focus:border-indigo-500/50 resize-y"
            placeholder={DEFAULT_BRAND_VOICE}
            disabled={busy}
          />
        </section>

        {/* Submit */}
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-40"
          >
            {busy ? "Creating…" : "Create Business"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/velo-admin/businesses")}
            disabled={busy}
            className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-medium text-white/80 hover:bg-white/5 disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
