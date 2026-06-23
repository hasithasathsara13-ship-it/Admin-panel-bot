"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { getActiveShopId } from "@/lib/activeShopId";

type Template = {
  name: string;
  status: string;
  category: string;
  language: string;
  components: Array<{ type: string; text?: string; format?: string; buttons?: Array<{ type: string; text: string; url?: string }> }>;
};

function statusBadge(status: string) {
  const s = status.toUpperCase();
  if (s === "APPROVED") return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (s === "PENDING") return "bg-amber-100 text-amber-700 border-amber-200";
  if (s === "REJECTED") return "bg-red-100 text-red-700 border-red-200";
  return "bg-gray-100 text-gray-700 border-gray-200";
}

function categoryLabel(cat: string) {
  if (cat === "MARKETING") return "Marketing";
  if (cat === "UTILITY") return "Utility";
  if (cat === "AUTHENTICATION") return "Auth";
  return cat;
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [formName, setFormName] = useState("");
  const [formCategory, setFormCategory] = useState("MARKETING");
  const [formLanguage, setFormLanguage] = useState("en");
  const [formHeader, setFormHeader] = useState("");
  const [formHeaderType, setFormHeaderType] = useState("NONE");
  const [formBody, setFormBody] = useState("");
  const [formFooter, setFormFooter] = useState("");
  const [formButtonText, setFormButtonText] = useState("");
  const [formButtonUrl, setFormButtonUrl] = useState("");

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const shopId = getActiveShopId();
      const res = await fetch(`/api/templates${shopId ? `?shop_id=${encodeURIComponent(shopId)}` : ""}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load templates");
        return;
      }
      setTemplates(data.templates ?? []);
    } catch {
      setError("Network error loading templates");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  async function createTemplate(e: FormEvent) {
    e.preventDefault();
    if (!formName.trim() || !formBody.trim()) {
      setError("Template name and body text are required.");
      return;
    }
    setCreating(true);
    setError(null);

    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName,
          category: formCategory,
          language: formLanguage,
          header_text: formHeaderType === "TEXT" ? formHeader || undefined : undefined,
          header_type: formHeaderType !== "NONE" ? formHeaderType : undefined,
          body_text: formBody,
          footer_text: formFooter || undefined,
          button_text: formButtonText || undefined,
          button_url: formButtonUrl || undefined,
          shop_id: getActiveShopId() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create template");
      } else {
        // Reset form and reload
        setFormName("");
        setFormHeader("");
        setFormBody("");
        setFormFooter("");
        setFormButtonText("");
        setFormButtonUrl("");
        setShowForm(false);
        await loadTemplates();
      }
    } catch {
      setError("Network error creating template");
    } finally {
      setCreating(false);
    }
  }

  async function deleteTemplate(name: string) {
    if (!window.confirm(`Delete template "${name}"? This cannot be undone.`)) return;
    setDeleting(name);
    setError(null);
    try {
      const shopId = getActiveShopId();
      const res = await fetch(`/api/templates?name=${encodeURIComponent(name)}${shopId ? `&shop_id=${encodeURIComponent(shopId)}` : ""}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error || "Failed to delete");
      } else {
        await loadTemplates();
      }
    } catch {
      setError("Network error deleting template");
    } finally {
      setDeleting(null);
    }
  }

  const approvedCount = templates.filter((t) => t.status.toUpperCase() === "APPROVED").length;
  const pendingCount = templates.filter((t) => t.status.toUpperCase() === "PENDING").length;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
            Message Templates
          </h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Create and manage WhatsApp message templates. Templates must be approved by Meta before use.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/messages/broadcast"
            className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            ← Broadcast
          </Link>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="rounded-xl bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
          >
            {showForm ? "Cancel" : "+ New Template"}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-[var(--color-border-card)] bg-[var(--color-surface)] px-4 py-3 text-center">
          <div className="text-2xl font-bold text-[var(--color-text-primary)]">{templates.length}</div>
          <div className="text-xs text-[var(--color-text-tertiary)]">Total</div>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center">
          <div className="text-2xl font-bold text-emerald-700">{approvedCount}</div>
          <div className="text-xs text-emerald-600">Approved</div>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center">
          <div className="text-2xl font-bold text-amber-700">{pendingCount}</div>
          <div className="text-xs text-amber-600">Pending</div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
          <button type="button" onClick={() => setError(null)} className="ml-2 font-medium underline">Dismiss</button>
        </div>
      )}

      {/* Create Template Form */}
      {showForm && (
        <form
          onSubmit={(e) => void createTemplate(e)}
          className="rounded-2xl border border-[var(--color-border-card)] bg-[var(--color-surface)] p-5 shadow-sm space-y-4"
        >
          <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)]">Create New Template</h2>
          <p className="text-xs text-[var(--color-text-tertiary)]">
            This will be submitted to Meta for review. Approval typically takes a few minutes to 24 hours.
          </p>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="grid gap-1 text-sm">
              <span className="text-xs font-medium text-[var(--color-text-secondary)]">
                Template Name <span className="text-red-500">*</span>
              </span>
              <input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. summer_sale_promo"
                className="h-10 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-3 text-sm outline-none focus:border-[var(--color-accent)]"
              />
              <span className="text-[10px] text-[var(--color-text-tertiary)]">Lowercase, underscores only</span>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-xs font-medium text-[var(--color-text-secondary)]">Category</span>
              <select
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value)}
                className="h-10 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-3 text-sm outline-none focus:border-[var(--color-accent)]"
              >
                <option value="MARKETING">Marketing</option>
                <option value="UTILITY">Utility</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-xs font-medium text-[var(--color-text-secondary)]">Language</span>
              <select
                value={formLanguage}
                onChange={(e) => setFormLanguage(e.target.value)}
                className="h-10 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-3 text-sm outline-none focus:border-[var(--color-accent)]"
              >
                <option value="en">English</option>
                <option value="en_US">English (US)</option>
                <option value="si">Sinhala</option>
                <option value="ta">Tamil</option>
              </select>
            </label>
          </div>

          <div className="grid gap-1 text-sm">
            <span className="text-xs font-medium text-[var(--color-text-secondary)]">Header (optional)</span>
            <div className="flex gap-2">
              <select
                value={formHeaderType}
                onChange={(e) => setFormHeaderType(e.target.value)}
                className="h-10 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-3 text-sm outline-none focus:border-[var(--color-accent)]"
              >
                <option value="NONE">None</option>
                <option value="TEXT">Text</option>
                <option value="IMAGE">Image (photo)</option>
                <option value="VIDEO">Video</option>
                <option value="DOCUMENT">Document</option>
              </select>
              {formHeaderType === "TEXT" && (
                <input
                  value={formHeader}
                  onChange={(e) => setFormHeader(e.target.value)}
                  placeholder="e.g. Special Offer!"
                  className="h-10 flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-3 text-sm outline-none focus:border-[var(--color-accent)]"
                />
              )}
            </div>
            {formHeaderType === "IMAGE" && (
              <span className="text-[10px] text-[var(--color-text-tertiary)]">
                Image will be provided when sending. Meta approves the template structure, not the specific image.
              </span>
            )}
          </div>

          <label className="grid gap-1 text-sm">
            <span className="text-xs font-medium text-[var(--color-text-secondary)]">
              Body Text <span className="text-red-500">*</span>
            </span>
            <textarea
              value={formBody}
              onChange={(e) => setFormBody(e.target.value)}
              rows={4}
              placeholder={"Hi {{1}}! 🎉 We have a special offer for you. Get {{2}}% off on all products this week!"}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] resize-y"
            />
            <span className="text-[10px] text-[var(--color-text-tertiary)]">
              Use {"{{1}}"}, {"{{2}}"} etc. for variables that can be personalized per recipient
            </span>
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-xs font-medium text-[var(--color-text-secondary)]">Footer (optional)</span>
            <input
              value={formFooter}
              onChange={(e) => setFormFooter(e.target.value)}
              placeholder="e.g. Reply STOP to unsubscribe"
              className="h-10 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-3 text-sm outline-none focus:border-[var(--color-accent)]"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="text-xs font-medium text-[var(--color-text-secondary)]">Button Label (optional)</span>
              <input
                value={formButtonText}
                onChange={(e) => setFormButtonText(e.target.value)}
                placeholder="e.g. Shop Now"
                className="h-10 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-3 text-sm outline-none focus:border-[var(--color-accent)]"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-xs font-medium text-[var(--color-text-secondary)]">Button URL (optional)</span>
              <input
                value={formButtonUrl}
                onChange={(e) => setFormButtonUrl(e.target.value)}
                placeholder="https://yourstore.com/offers"
                className="h-10 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-3 text-sm outline-none focus:border-[var(--color-accent)]"
              />
            </label>
          </div>

          {/* Preview */}
          {formBody && (
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)] mb-2">Preview</div>
              <div className="rounded-lg bg-white border border-gray-200 p-3 max-w-[280px] shadow-sm">
                {formHeaderType === "IMAGE" && (
                  <div className="mb-2 rounded-lg bg-gray-100 h-32 flex items-center justify-center text-gray-400 text-xs">📷 Image header</div>
                )}
                {formHeaderType === "VIDEO" && (
                  <div className="mb-2 rounded-lg bg-gray-100 h-32 flex items-center justify-center text-gray-400 text-xs">🎬 Video header</div>
                )}
                {formHeaderType === "DOCUMENT" && (
                  <div className="mb-2 rounded-lg bg-gray-100 h-10 flex items-center justify-center text-gray-400 text-xs">📄 Document header</div>
                )}
                {formHeaderType === "TEXT" && formHeader && <div className="text-sm font-bold text-gray-900 mb-1">{formHeader}</div>}
                <div className="text-sm text-gray-700 whitespace-pre-wrap">{formBody}</div>
                {formFooter && <div className="text-[11px] text-gray-400 mt-2">{formFooter}</div>}
                {formButtonText && (
                  <div className="mt-2 border-t border-gray-100 pt-2">
                    <div className="text-center text-sm font-medium text-blue-600">{formButtonText}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-xl border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="rounded-xl bg-[var(--color-accent)] px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {creating ? "Submitting..." : "Submit for Approval"}
            </button>
          </div>
        </form>
      )}

      {/* Templates List */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-[var(--color-text-tertiary)]">
          Loading templates...
        </div>
      ) : templates.length === 0 ? (
        <div className="rounded-2xl border border-[var(--color-border-card)] bg-[var(--color-surface)] p-10 text-center">
          <div className="text-4xl mb-3">📝</div>
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">No templates yet</h3>
          <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
            Create your first template to start sending promotional messages.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((t) => (
            <div
              key={`${t.name}-${t.language}`}
              className="rounded-xl border border-[var(--color-border-card)] bg-[var(--color-surface)] p-4 flex items-start justify-between gap-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-[var(--color-text-primary)] font-mono">
                    {t.name}
                  </span>
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${statusBadge(t.status)}`}>
                    {t.status}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-surface-secondary)] text-[var(--color-text-tertiary)]">
                    {categoryLabel(t.category)}
                  </span>
                  <span className="text-[10px] text-[var(--color-text-tertiary)]">
                    {t.language}
                  </span>
                </div>
                <div className="mt-1.5 text-xs text-[var(--color-text-secondary)]">
                  {t.components
                    .filter((c) => c.type === "BODY")
                    .map((c) => c.text)
                    .join("") || "—"}
                </div>
              </div>
              <button
                type="button"
                disabled={deleting === t.name}
                onClick={() => void deleteTemplate(t.name)}
                className="flex-shrink-0 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] font-medium text-red-600 hover:bg-red-100 disabled:opacity-50 transition-colors"
              >
                {deleting === t.name ? "..." : "Delete"}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Refresh button */}
      <div className="flex justify-center">
        <button
          type="button"
          onClick={() => void loadTemplates()}
          disabled={loading}
          className="rounded-xl border border-[var(--color-border)] px-4 py-2 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
        >
          {loading ? "Refreshing..." : "🔄 Refresh Status"}
        </button>
      </div>
    </div>
  );
}
