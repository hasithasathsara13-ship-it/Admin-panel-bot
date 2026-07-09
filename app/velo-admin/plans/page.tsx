"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Plan = {
  id: string;
  display_name: string;
  description: string;
  monthly_price_lkr: number;
  included_messages: number;
  free_business_templates: number;
  service_convo_cap: number;
  max_products: number | null;
  max_orders_per_month: number | null;
  features: string[];
  is_active: boolean;
  sort_order: number;
  updated_at: string;
};

function lkr(n: number) {
  return `LKR ${n.toLocaleString()}`;
}

export default function PlansPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Edit form
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editMessages, setEditMessages] = useState("");
  const [editMaxProducts, setEditMaxProducts] = useState("");
  const [editFreeTemplates, setEditFreeTemplates] = useState("");
  const [editServiceConvoCap, setEditServiceConvoCap] = useState("");
  const [editFeatures, setEditFeatures] = useState("");

  const loadPlans = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/velo-admin/plans", { credentials: "include" });
    if (res.status === 401) {
      router.replace("/login?next=/velo-admin/plans");
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { plans?: Plan[]; error?: string };
    if (!res.ok) {
      setError(data.error || "Failed to load plans");
      setLoading(false);
      return;
    }
    setPlans(data.plans ?? []);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  function startEdit(plan: Plan) {
    setEditingId(plan.id);
    setEditName(plan.display_name);
    setEditDesc(plan.description);
    setEditPrice(String(plan.monthly_price_lkr));
    setEditMessages(String(plan.included_messages));
    setEditMaxProducts(plan.max_products === null ? "" : String(plan.max_products));
    setEditFreeTemplates(String(plan.free_business_templates ?? 25));
    setEditServiceConvoCap(String(plan.service_convo_cap ?? 1000));
    setEditFeatures((plan.features ?? []).join("\n"));
    setError(null);
    setSuccess(null);
  }

  async function savePlan() {
    if (!editingId) return;
    setSaving(editingId);
    setError(null);
    setSuccess(null);

    const res = await fetch("/api/velo-admin/plans", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        id: editingId,
        display_name: editName,
        description: editDesc,
        monthly_price_lkr: Number(editPrice) || 0,
        included_messages: Number(editMessages) || 0,
        max_products: editMaxProducts.trim() === "" ? null : Number(editMaxProducts),
        free_business_templates: Number(editFreeTemplates) || 25,
        service_convo_cap: Number(editServiceConvoCap) || 1000,
        features: editFeatures.split("\n").map((f) => f.trim()).filter(Boolean),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setSaving(null);

    if (!res.ok) {
      setError(data.error || "Failed to save");
    } else {
      setSuccess(`Plan "${editingId}" updated! Changes apply to all businesses on this plan.`);
      setEditingId(null);
      await loadPlans();
      setTimeout(() => setSuccess(null), 5000);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Edit Plans</h1>
        <p className="mt-1 text-sm text-white/60">
          Manage pricing, message limits, and features for each plan. Changes apply to all existing and new subscribers.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
      )}
      {success && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</div>
      )}

      {loading ? (
        <div className="flex min-h-[30vh] items-center justify-center text-white/60">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
        </div>
      ) : plans.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-[#0c101c]/80 p-12 text-center text-white/60">
          No plans found. Run the plans_table.sql migration first.
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          {plans.map((plan) => {
            const isEditing = editingId === plan.id;
            return (
              <div
                key={plan.id}
                className={[
                  "rounded-2xl border p-5 transition-all",
                  isEditing
                    ? "border-indigo-500/50 bg-indigo-500/5 ring-1 ring-inset ring-indigo-500/30"
                    : "border-white/10 bg-[#0c101c]/80 hover:border-white/20",
                ].join(" ")}
              >
                {isEditing ? (
                  /* Editing mode */
                  <div className="space-y-3">
                    <label className="block space-y-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-white/60">Plan Name</span>
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="velo-admin-input w-full rounded-lg border border-white/10 px-3 py-2 text-sm outline-none focus:border-indigo-500/50"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-white/60">Description</span>
                      <input
                        value={editDesc}
                        onChange={(e) => setEditDesc(e.target.value)}
                        className="velo-admin-input w-full rounded-lg border border-white/10 px-3 py-2 text-sm outline-none focus:border-indigo-500/50"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-white/60">Monthly Price (LKR)</span>
                      <input
                        value={editPrice}
                        onChange={(e) => setEditPrice(e.target.value)}
                        type="number"
                        className="velo-admin-input w-full rounded-lg border border-white/10 px-3 py-2 text-sm font-mono outline-none focus:border-indigo-500/50"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-white/60">Included Messages / Period</span>
                      <input
                        value={editMessages}
                        onChange={(e) => setEditMessages(e.target.value)}
                        type="number"
                        className="velo-admin-input w-full rounded-lg border border-white/10 px-3 py-2 text-sm font-mono outline-none focus:border-indigo-500/50"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-white/60">Max Products (empty = unlimited)</span>
                      <input
                        value={editMaxProducts}
                        onChange={(e) => setEditMaxProducts(e.target.value)}
                        type="number"
                        placeholder="Unlimited"
                        className="velo-admin-input w-full rounded-lg border border-white/10 px-3 py-2 text-sm font-mono outline-none focus:border-indigo-500/50"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-white/60">Free Business Templates / Month</span>
                      <input
                        value={editFreeTemplates}
                        onChange={(e) => setEditFreeTemplates(e.target.value)}
                        type="number"
                        placeholder="25"
                        className="velo-admin-input w-full rounded-lg border border-white/10 px-3 py-2 text-sm font-mono outline-none focus:border-indigo-500/50"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-white/60">Service Convo Cap / Month</span>
                      <input
                        value={editServiceConvoCap}
                        onChange={(e) => setEditServiceConvoCap(e.target.value)}
                        type="number"
                        placeholder="1000"
                        className="velo-admin-input w-full rounded-lg border border-white/10 px-3 py-2 text-sm font-mono outline-none focus:border-indigo-500/50"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-white/60">Features (one per line)</span>
                      <textarea
                        value={editFeatures}
                        onChange={(e) => setEditFeatures(e.target.value)}
                        rows={4}
                        className="velo-admin-input w-full rounded-lg border border-white/10 px-3 py-2 text-sm outline-none focus:border-indigo-500/50 resize-y"
                      />
                    </label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void savePlan()}
                        disabled={saving === plan.id}
                        className="flex-1 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                      >
                        {saving === plan.id ? "Saving…" : "Save Changes"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded-lg border border-white/15 px-3 py-2 text-sm text-white/80 hover:bg-white/5"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  /* View mode */
                  <>
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="text-lg font-bold text-white">{plan.display_name}</h3>
                        <p className="text-xs text-white/50 mt-0.5">{plan.description}</p>
                      </div>
                      {!plan.is_active && (
                        <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-300">Disabled</span>
                      )}
                    </div>

                    <div className="mt-4 font-mono text-2xl font-bold text-white">
                      {lkr(plan.monthly_price_lkr)}
                      <span className="text-sm font-normal text-white/50">/mo</span>
                    </div>

                    <div className="mt-4 space-y-2 text-xs text-white/70">
                      <div className="flex justify-between">
                        <span>Messages/period</span>
                        <span className="font-semibold text-white">{plan.included_messages.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Free templates/month</span>
                        <span className="font-semibold text-white">{plan.free_business_templates ?? 25}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Service convo cap</span>
                        <span className="font-semibold text-white">{(plan.service_convo_cap ?? 1000).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Max products</span>
                        <span className="font-semibold text-white">{plan.max_products ?? "Unlimited"}</span>
                      </div>
                    </div>

                    {plan.features?.length > 0 && (
                      <div className="mt-4 space-y-1.5">
                        {plan.features.map((f, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs text-white/60">
                            <span className="text-emerald-400">✓</span>
                            {f}
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="mt-4 pt-3 border-t border-white/5">
                      <button
                        type="button"
                        onClick={() => startEdit(plan)}
                        className="w-full rounded-lg border border-white/15 px-3 py-2 text-sm font-medium text-white/80 hover:bg-white/5 transition-colors"
                      >
                        Edit Plan
                      </button>
                    </div>

                    <div className="mt-2 text-[10px] text-white/30">
                      Last updated: {new Date(plan.updated_at).toLocaleString()}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
