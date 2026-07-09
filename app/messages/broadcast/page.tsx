"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getActiveShopId } from "@/lib/activeShopId";

type MetaTemplate = {
  name: string;
  status: string;
  category: string;
  language: string;
  components: Array<{ type: string; text?: string }>;
};

export default function BroadcastPage() {
  const [metaTemplates, setMetaTemplates] = useState<MetaTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const shopId = typeof window !== "undefined" ? getActiveShopId() : null;

  useEffect(() => {
    if (!shopId) { setLoading(false); return; }
    void (async () => {
      try {
        const res = await fetch(`/api/templates?shop_id=${encodeURIComponent(shopId)}`);
        const data = await res.json();
        if (res.ok && data.templates) {
          setMetaTemplates(data.templates);
        }
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, [shopId]);

  const approved = metaTemplates.filter((t) => t.status.toUpperCase() === "APPROVED");
  const pending = metaTemplates.filter((t) => t.status.toUpperCase() === "PENDING");
  const rejected = metaTemplates.filter((t) => t.status.toUpperCase() === "REJECTED");

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--color-text-primary)" }}>
            Bulk & Templates
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            Manage your message templates and send bulk broadcasts.
          </p>
        </div>
        <Link
          href="/messages"
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
        >
          ← Back to Messages
        </Link>
      </div>

      {/* Bulk Broadcast CTA */}
      <div className="rounded-2xl border border-[var(--color-border-card)] p-6 text-center" style={{ background: "var(--color-surface-solid)" }}>
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl mb-4" style={{ background: "var(--color-accent-light)" }}>
          <svg className="w-7 h-7" style={{ color: "var(--color-accent)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 1 1 0-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 0 1-1.44-4.282m3.102.069a18.03 18.03 0 0 1-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 0 1 8.835 2.535M10.34 6.66a23.847 23.847 0 0 0 8.835-2.535m0 0A23.74 23.74 0 0 0 18.795 3m.38 1.125a23.91 23.91 0 0 1 1.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 0 0 1.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 0 1 0 3.46" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold" style={{ color: "var(--color-text-primary)" }}>
          Send Bulk Messages
        </h2>
        <p className="mt-2 text-sm max-w-md mx-auto" style={{ color: "var(--color-text-tertiary)" }}>
          Send template messages to all your bot contacts at once. Manage recipients, schedule broadcasts, and track delivery.
        </p>
        <a
          href="https://bulk.veloai.pro"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-white transition-all hover:opacity-90 shadow-lg"
          style={{ background: "linear-gradient(135deg, var(--color-accent), var(--color-accent-dark))" }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
          </svg>
          Open Bulk Broadcast Portal
        </a>
      </div>

      {/* Manage Templates */}
      <div className="rounded-2xl border border-[var(--color-border-card)] p-5" style={{ background: "var(--color-surface-solid)" }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-[15px] font-semibold" style={{ color: "var(--color-text-primary)" }}>
              Message Templates
            </h2>
            <p className="mt-0.5 text-xs" style={{ color: "var(--color-text-tertiary)" }}>
              {metaTemplates.length} template{metaTemplates.length !== 1 ? "s" : ""} synced from Meta
            </p>
          </div>
          <Link
            href="/messages/templates"
            className="rounded-xl px-4 py-2 text-xs font-semibold text-white transition-all hover:opacity-90"
            style={{ background: "var(--color-accent)" }}
          >
            Manage Templates
          </Link>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-sm" style={{ color: "var(--color-text-tertiary)" }}>
            Loading templates...
          </div>
        ) : metaTemplates.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center" style={{ borderColor: "var(--color-border)", color: "var(--color-text-tertiary)" }}>
            <p className="text-sm">No templates found.</p>
            <p className="mt-1 text-xs">Create templates in the Manage Templates page to use for broadcasts.</p>
          </div>
        ) : (
          <>
            {/* Stats */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="rounded-xl p-3 text-center" style={{ background: "var(--color-success-light)" }}>
                <div className="text-lg font-bold" style={{ color: "var(--color-success)" }}>{approved.length}</div>
                <div className="text-[10px] font-medium" style={{ color: "var(--color-success)" }}>Approved</div>
              </div>
              <div className="rounded-xl p-3 text-center" style={{ background: "var(--color-warning-light)" }}>
                <div className="text-lg font-bold" style={{ color: "var(--color-warning)" }}>{pending.length}</div>
                <div className="text-[10px] font-medium" style={{ color: "var(--color-warning)" }}>Pending</div>
              </div>
              <div className="rounded-xl p-3 text-center" style={{ background: "var(--color-danger-light)" }}>
                <div className="text-lg font-bold" style={{ color: "var(--color-danger)" }}>{rejected.length}</div>
                <div className="text-[10px] font-medium" style={{ color: "var(--color-danger)" }}>Rejected</div>
              </div>
            </div>

            {/* Template list */}
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {metaTemplates.map((t, idx) => {
                const statusColor = t.status.toUpperCase() === "APPROVED"
                  ? "var(--color-success)"
                  : t.status.toUpperCase() === "PENDING"
                    ? "var(--color-warning)"
                    : "var(--color-danger)";
                const bodyText = t.components.find((c) => c.type === "BODY")?.text || "";
                return (
                  <div
                    key={`${t.name}-${t.language}-${idx}`}
                    className="rounded-xl border p-3"
                    style={{ borderColor: "var(--color-border-card)", background: "var(--color-surface-secondary)" }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate" style={{ color: "var(--color-text-primary)" }}>
                        {t.name}
                      </span>
                      <span
                        className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
                        style={{ color: statusColor, background: `color-mix(in srgb, ${statusColor} 15%, transparent)` }}
                      >
                        {t.status}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px]" style={{ color: "var(--color-text-tertiary)" }}>
                      <span>{t.language}</span>
                      <span>·</span>
                      <span>{t.category}</span>
                    </div>
                    {bodyText && (
                      <p className="mt-1.5 text-xs line-clamp-2" style={{ color: "var(--color-text-secondary)" }}>
                        {bodyText}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
