"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const DEFAULT_BRAND_VOICE = "Friendly assistant speaking English and Singlish.";
const MAX_BRAND_VOICE_CHARS = 12000;

type BusinessRow = {
  id: string;
  business_name: string | null;
  support_email: string | null;
  whatsapp_number: string | null;
  brand_voice: string | null;
  billing_plan: string | null;
  billing_cycle: string | null;
  subscription_status: string | null;
  billing_next_due_at: string | null;
  billing_messages_used_period: number | null;
  /** Rows in `messages` for this shop in the last 30 UTC days (from API). */
  messages_count_30d?: number;
  billing_quota_hard_block: boolean | null;
  billing_last_marked_paid_at: string | null;
  created_at: string | null;
};

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export default function VeloBusinessesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<BusinessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { plan: string; cycle: string }>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addForm, setAddForm] = useState({
    business_name: "",
    support_email: "",
    whatsapp_number: "",
    business_category: "",
    brand_voice: "",
  });
  const [voiceShopId, setVoiceShopId] = useState("");
  const [voiceDraft, setVoiceDraft] = useState("");
  const [voiceBusy, setVoiceBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/velo-admin/businesses", { credentials: "include" });
    if (res.status === 401) {
      router.replace("/login?next=" + encodeURIComponent("/velo-admin/businesses"));
      return;
    }
    const data = (await res.json().catch(() => ({}))) as {
      businesses?: BusinessRow[];
      error?: string;
    };
    if (!res.ok) {
      setError(data.error || `Failed to load (${res.status})`);
      setRows([]);
      setLoading(false);
      return;
    }
    const list = data.businesses ?? [];
    setRows(list);
    const d: Record<string, { plan: string; cycle: string }> = {};
    for (const r of list) {
      d[r.id] = {
        plan: String(r.billing_plan ?? "Starter"),
        cycle: String(r.billing_cycle ?? "Monthly"),
      };
    }
    setDrafts(d);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    if (rows.length === 0) {
      setVoiceShopId("");
      setVoiceDraft("");
      return;
    }
    setVoiceShopId((prev) => (prev && rows.some((r) => r.id === prev) ? prev : rows[0].id));
  }, [rows]);

  useEffect(() => {
    const row = rows.find((r) => r.id === voiceShopId);
    if (!row) {
      setVoiceDraft("");
      return;
    }
    const v = row.brand_voice?.trim();
    setVoiceDraft(v && v.length > 0 ? v : DEFAULT_BRAND_VOICE);
  }, [rows, voiceShopId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function markPaid(id: string) {
    setBusyId(id);
    setError(null);
    const res = await fetch("/api/velo-admin/mark-paid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ shop_id: id }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setBusyId(null);
    if (!res.ok) {
      setError(data.error || "Mark paid failed");
      return;
    }
    await load();
  }

  async function setStatus(id: string, subscription_status: "active" | "past_due" | "canceled") {
    setBusyId(id);
    setError(null);
    const body: Record<string, unknown> = { shop_id: id, subscription_status };
    if (subscription_status === "past_due") {
      body.billing_next_due_at = new Date().toISOString();
    }
    const res = await fetch("/api/velo-admin/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setBusyId(null);
    if (!res.ok) {
      setError(data.error || "Update failed");
      return;
    }
    await load();
  }

  async function savePlanCycle(id: string) {
    const d = drafts[id];
    if (!d) return;
    setBusyId(id);
    setError(null);
    const res = await fetch("/api/velo-admin/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        shop_id: id,
        billing_plan: d.plan,
        billing_cycle: d.cycle,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setBusyId(null);
    if (!res.ok) {
      setError(data.error || "Update failed");
      return;
    }
    await load();
  }

  async function saveBrandVoice() {
    if (!voiceShopId) return;
    if (voiceDraft.length > MAX_BRAND_VOICE_CHARS) {
      setError(`Brand voice must be at most ${MAX_BRAND_VOICE_CHARS} characters.`);
      return;
    }
    setVoiceBusy(true);
    setError(null);
    const res = await fetch("/api/velo-admin/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ shop_id: voiceShopId, brand_voice: voiceDraft }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setVoiceBusy(false);
    if (res.status === 401) {
      router.replace("/login?next=" + encodeURIComponent("/velo-admin/businesses"));
      return;
    }
    if (!res.ok) {
      setError(data.error || "Could not save brand voice");
      return;
    }
    await load();
  }

  async function createBusiness(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = addForm.business_name.trim();
    if (!name) {
      setError("Business name is required.");
      return;
    }
    setAddBusy(true);
    setError(null);
    const payload: Record<string, string | null> = { business_name: name };
    const email = addForm.support_email.trim();
    const wa = addForm.whatsapp_number.trim();
    const cat = addForm.business_category.trim();
    if (email) payload.support_email = email;
    if (wa) payload.whatsapp_number = wa;
    if (cat) payload.business_category = cat;
    const bv = addForm.brand_voice.trim();
    if (bv) payload.brand_voice = bv;

    const res = await fetch("/api/velo-admin/businesses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setAddBusy(false);
    if (res.status === 401) {
      router.replace("/login?next=" + encodeURIComponent("/velo-admin/businesses"));
      return;
    }
    if (!res.ok) {
      setError(data.error || "Could not create business");
      return;
    }
    setAddForm({
      business_name: "",
      support_email: "",
      whatsapp_number: "",
      business_category: "",
      brand_voice: "",
    });
    setAddOpen(false);
    await load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Business manage</h1>
          <p className="mt-1 text-sm text-white/80">Plans, billing status, mark paid, and lifecycle.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setAddOpen((v) => !v)}
            className="rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-500/25"
          >
            {addOpen ? "Close form" : "Add business"}
          </button>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/10"
          >
            Refresh
          </button>
          <Link
            href="/velo-admin/analytics"
            className="rounded-xl border border-indigo-500/40 bg-indigo-500/15 px-4 py-2 text-sm font-semibold text-indigo-100 hover:bg-indigo-500/25"
          >
            View analytics
          </Link>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      {!loading ? (
        <section className="rounded-2xl border border-white/10 bg-[#0c101c]/80 p-5 shadow-xl shadow-black/30">
          <h2 className="text-sm font-semibold text-white">Brand voice</h2>
          <p className="mt-1 text-xs text-white/75">
            Stored in Supabase as <code className="rounded bg-white/10 px-1 text-[11px]">businesses.brand_voice</code>.
            Guides how the AI should sound for that workspace.
          </p>
          {rows.length === 0 ? (
            <p className="mt-3 text-sm text-white/70">Add a business first to edit brand voice.</p>
          ) : (
            <div className="mt-4 space-y-3">
              <label className="block space-y-1.5">
                <span className="text-[11px] font-medium uppercase tracking-wide text-white/75">Workspace</span>
                <select
                  className="velo-admin-select w-full max-w-md rounded-lg border border-white/10 bg-[#070a12] px-3 py-2 text-sm text-white outline-none focus:border-indigo-500/50"
                  value={voiceShopId}
                  disabled={voiceBusy}
                  onChange={(e) => setVoiceShopId(e.target.value)}
                >
                  {rows.map((r) => (
                    <option key={r.id} value={r.id}>
                      {(r.business_name || "Untitled").slice(0, 48)}
                      {r.business_name && r.business_name.length > 48 ? "…" : ""} · {r.id.slice(0, 8)}…
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1.5">
                <span className="text-[11px] font-medium uppercase tracking-wide text-white/75">
                  Brand voice prompt
                </span>
                <textarea
                  className="velo-admin-input min-h-[140px] w-full resize-y rounded-lg border border-white/10 bg-[#070a12] px-3 py-2 text-sm leading-relaxed text-white outline-none focus:border-indigo-500/50"
                  maxLength={MAX_BRAND_VOICE_CHARS}
                  value={voiceDraft}
                  disabled={voiceBusy}
                  onChange={(e) => setVoiceDraft(e.target.value)}
                  placeholder={DEFAULT_BRAND_VOICE}
                />
                <div className="text-right text-[10px] text-white/50">
                  {voiceDraft.length} / {MAX_BRAND_VOICE_CHARS}
                </div>
              </label>
              <button
                type="button"
                disabled={voiceBusy || !voiceShopId}
                onClick={() => void saveBrandVoice()}
                className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-40"
              >
                {voiceBusy ? "Saving…" : "Save brand voice"}
              </button>
            </div>
          )}
        </section>
      ) : null}

      {addOpen ? (
        <form
          onSubmit={(e) => void createBusiness(e)}
          className="rounded-2xl border border-white/10 bg-[#0c101c]/80 p-5 shadow-xl shadow-black/30"
        >
          <h2 className="text-sm font-semibold text-white">New business</h2>
          <p className="mt-1 text-xs text-white/75">
            Creates a shop row without linking an auth user. The owner can be attached later from product
            flows or your database if needed.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-white/75">
                Business name <span className="text-rose-400">*</span>
              </span>
              <input
                required
                value={addForm.business_name}
                onChange={(e) => setAddForm((f) => ({ ...f, business_name: e.target.value }))}
                className="velo-admin-input w-full rounded-lg border border-white/10 bg-[#070a12] px-3 py-2 text-sm text-white outline-none focus:border-indigo-500/50"
                placeholder="e.g. Acme Store"
                disabled={addBusy}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-white/75">Support email</span>
              <input
                type="email"
                value={addForm.support_email}
                onChange={(e) => setAddForm((f) => ({ ...f, support_email: e.target.value }))}
                className="velo-admin-input w-full rounded-lg border border-white/10 bg-[#070a12] px-3 py-2 text-sm text-white outline-none focus:border-indigo-500/50"
                placeholder="owner@example.com"
                disabled={addBusy}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-white/75">WhatsApp number</span>
              <input
                value={addForm.whatsapp_number}
                onChange={(e) => setAddForm((f) => ({ ...f, whatsapp_number: e.target.value }))}
                className="velo-admin-input w-full rounded-lg border border-white/10 bg-[#070a12] px-3 py-2 text-sm text-white outline-none focus:border-indigo-500/50"
                placeholder="+94771234567"
                disabled={addBusy}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-white/75">Category</span>
              <input
                value={addForm.business_category}
                onChange={(e) => setAddForm((f) => ({ ...f, business_category: e.target.value }))}
                className="velo-admin-input w-full rounded-lg border border-white/10 bg-[#070a12] px-3 py-2 text-sm text-white outline-none focus:border-indigo-500/50"
                placeholder="Retail, services…"
                disabled={addBusy}
              />
            </label>
            <label className="block space-y-1.5 sm:col-span-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-white/75">
                Brand voice <span className="font-normal normal-case text-white/50">(optional)</span>
              </span>
              <textarea
                className="velo-admin-input min-h-[100px] w-full resize-y rounded-lg border border-white/10 bg-[#070a12] px-3 py-2 text-sm leading-relaxed text-white outline-none focus:border-indigo-500/50"
                maxLength={MAX_BRAND_VOICE_CHARS}
                value={addForm.brand_voice}
                onChange={(e) => setAddForm((f) => ({ ...f, brand_voice: e.target.value }))}
                placeholder={DEFAULT_BRAND_VOICE}
                disabled={addBusy}
              />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={addBusy}
              className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-40"
            >
              {addBusy ? "Creating…" : "Create business"}
            </button>
            <button
              type="button"
              disabled={addBusy}
              onClick={() => {
                setAddForm({
                  business_name: "",
                  support_email: "",
                  whatsapp_number: "",
                  business_category: "",
                  brand_voice: "",
                });
                setAddOpen(false);
              }}
              className="rounded-xl border border-white/15 bg-transparent px-4 py-2 text-sm font-medium text-white/85 hover:bg-white/5 disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center text-white/75">
          <div className="flex flex-col items-center gap-3">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
            Loading businesses…
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0c101c]/80 shadow-xl shadow-black/30">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1024px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/[0.04] text-[11px] font-semibold uppercase tracking-wider text-white/75">
                  <th className="px-4 py-3">Business</th>
                  <th className="px-4 py-3">Contact</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Cycle</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Next due</th>
                  <th
                    className="px-4 py-3"
                    title="Main number = chat rows in messages (30d UTC). Sub = billing webhook counter for this period."
                  >
                    Msgs (30d)
                  </th>
                  <th className="px-4 py-3">Quota</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-white/[0.06] transition hover:bg-white/[0.03]"
                  >
                    <td className="px-4 py-3 font-medium text-white">
                      {r.business_name || "—"}
                      <div className="font-mono text-[10px] text-white/55">{r.id}</div>
                    </td>
                    <td className="max-w-[200px] px-4 py-3 text-white/85">
                      <div className="truncate text-xs">{r.support_email || "—"}</div>
                      <div className="truncate text-[11px] text-white/75">{r.whatsapp_number || "—"}</div>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        className="velo-admin-select w-full max-w-[118px] rounded-lg border border-white/10 bg-[#070a12] px-2 py-1.5 text-xs text-white outline-none focus:border-indigo-500/50"
                        value={drafts[r.id]?.plan ?? "Starter"}
                        disabled={busyId === r.id}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [r.id]: {
                              ...prev[r.id],
                              plan: e.target.value,
                              cycle: prev[r.id]?.cycle ?? "Monthly",
                            },
                          }))
                        }
                      >
                        <option value="Starter">Starter</option>
                        <option value="Growth">Growth</option>
                        <option value="Scale">Scale</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        className="velo-admin-select w-full max-w-[108px] rounded-lg border border-white/10 bg-[#070a12] px-2 py-1.5 text-xs text-white outline-none focus:border-indigo-500/50"
                        value={drafts[r.id]?.cycle ?? "Monthly"}
                        disabled={busyId === r.id}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [r.id]: {
                              ...prev[r.id],
                              cycle: e.target.value,
                              plan: prev[r.id]?.plan ?? "Starter",
                            },
                          }))
                        }
                      >
                        <option value="Monthly">Monthly</option>
                        <option value="Yearly">Yearly</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={[
                          "inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize",
                          String(r.subscription_status) === "active"
                            ? "bg-emerald-500/15 text-emerald-300"
                            : String(r.subscription_status) === "past_due"
                              ? "bg-amber-500/15 text-amber-200"
                              : "bg-slate-500/20 text-white/85",
                        ].join(" ")}
                      >
                        {String(r.subscription_status ?? "active").replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-white/80">
                      {fmt(r.billing_next_due_at)}
                    </td>
                    <td
                      className="px-4 py-3 font-mono text-xs text-white/90"
                      title="Chat messages in DB (30d). Sub-line = billed inbound (WhatsApp webhook) this period."
                    >
                      <div>{(r.messages_count_30d ?? 0).toLocaleString()}</div>
                      <div className="mt-0.5 text-[10px] font-normal text-white/45">
                        billed {(r.billing_messages_used_period ?? 0).toLocaleString()}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-white/80">
                      {r.billing_quota_hard_block ? (
                        <span className="text-rose-300">Yes</span>
                      ) : (
                        "No"
                      )}
                    </td>
                    <td className="space-y-1.5 px-4 py-3">
                      <button
                        type="button"
                        disabled={busyId === r.id}
                        onClick={() => void savePlanCycle(r.id)}
                        className="block w-full rounded-lg bg-white/10 px-2 py-1.5 text-[11px] font-medium text-white hover:bg-white/15 disabled:opacity-40"
                      >
                        Save plan
                      </button>
                      <button
                        type="button"
                        disabled={busyId === r.id}
                        onClick={() => void markPaid(r.id)}
                        className="block w-full rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-2 py-1.5 text-[11px] font-semibold text-white shadow-sm disabled:opacity-40"
                      >
                        Mark paid
                      </button>
                      <button
                        type="button"
                        disabled={busyId === r.id}
                        onClick={() => void setStatus(r.id, "past_due")}
                        className="block w-full rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] font-medium text-amber-100 hover:bg-amber-500/15 disabled:opacity-40"
                      >
                        Set past due
                      </button>
                      <button
                        type="button"
                        disabled={busyId === r.id}
                        onClick={() => void setStatus(r.id, "active")}
                        className="block w-full rounded-lg border border-white/10 bg-transparent px-2 py-1.5 text-[11px] font-medium text-white/85 hover:bg-white/5 disabled:opacity-40"
                      >
                        Set active
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-white/75">No businesses found.</div>
          ) : null}
        </div>
      )}
    </div>
  );
}
