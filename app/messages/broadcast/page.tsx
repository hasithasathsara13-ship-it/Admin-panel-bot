"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getActiveShopId } from "@/lib/activeShopId";

type Contact = {
  phone: string;
  name: string | null;
  lastMessageAt: string;
  messageCount: number;
};

const TEMPLATE_OPTIONS = [
  { id: "hello_world", name: "Hello World", description: "Default Meta test template", language: "en_US" },
];

type MetaTemplate = {
  name: string;
  status: string;
  category: string;
  language: string;
  components: Array<{ type: string; text?: string }>;
};

type FilterMode = "all" | "recent_7d" | "recent_30d" | "inactive_30d" | "manual";

export default function BroadcastPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metaTemplates, setMetaTemplates] = useState<MetaTemplate[]>([]);

  // Selection
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [selectedPhones, setSelectedPhones] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [manualNumbers, setManualNumbers] = useState("");

  // Message
  const [messageType, setMessageType] = useState<"template" | "text">("template");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [customText, setCustomText] = useState("");

  // Sending state
  const [sending, setSending] = useState(false);
  const [manualWarningOpen, setManualWarningOpen] = useState(false);
  const [customTextPopup, setCustomTextPopup] = useState(false);
  const [result, setResult] = useState<{
    sent: number;
    failed: number;
    total: number;
    errors: { phone: string; error?: string }[];
  } | null>(null);

  const shopId = typeof window !== "undefined" ? getActiveShopId() : null;

  const loadContacts = useCallback(async () => {
    if (!shopId) {
      setError("No shop selected. Please login again.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/broadcast?shop_id=${encodeURIComponent(shopId)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load contacts");
        return;
      }
      setContacts(data.contacts ?? []);
    } catch {
      setError("Failed to load contacts");
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  useEffect(() => {
    void loadContacts();
    // Load approved templates from Meta
    void (async () => {
      try {
        const res = await fetch(`/api/templates${shopId ? `?shop_id=${encodeURIComponent(shopId)}` : ""}`);
        const data = await res.json();
        if (res.ok && data.templates) {
          setMetaTemplates(data.templates.filter((t: MetaTemplate) => t.status.toUpperCase() === "APPROVED"));
        }
      } catch { /* ignore */ }
    })();
  }, [loadContacts]);

  // Apply filters
  const filteredContacts = useMemo(() => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    let filtered = contacts;

    switch (filterMode) {
      case "recent_7d":
        filtered = contacts.filter(
          (c) => now - new Date(c.lastMessageAt).getTime() <= 7 * day,
        );
        break;
      case "recent_30d":
        filtered = contacts.filter(
          (c) => now - new Date(c.lastMessageAt).getTime() <= 30 * day,
        );
        break;
      case "inactive_30d":
        filtered = contacts.filter(
          (c) => now - new Date(c.lastMessageAt).getTime() > 30 * day,
        );
        break;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.phone.includes(q) ||
          (c.name && c.name.toLowerCase().includes(q)),
      );
    }

    return filtered;
  }, [contacts, filterMode, searchQuery]);

  // Get the actual recipients list
  const recipients = useMemo(() => {
    if (filterMode === "manual") {
      return manualNumbers
        .split(/[\n,;]+/)
        .map((n) => n.trim())
        .filter(Boolean);
    }
    if (selectedPhones.size > 0) {
      return Array.from(selectedPhones);
    }
    return filteredContacts.map((c) => c.phone);
  }, [filterMode, manualNumbers, selectedPhones, filteredContacts]);

  function togglePhone(phone: string) {
    setSelectedPhones((prev) => {
      const next = new Set(prev);
      if (next.has(phone)) next.delete(phone);
      else next.add(phone);
      return next;
    });
  }

  function selectAll() {
    setSelectedPhones(new Set(filteredContacts.map((c) => c.phone)));
  }

  function deselectAll() {
    setSelectedPhones(new Set());
  }

  async function handleSpreadsheetUpload(file: File) {
    const name = file.name.toLowerCase();
    try {
      if (name.endsWith(".csv") || file.type === "text/csv") {
        // Parse CSV
        const text = await file.text();
        const numbers = extractNumbersFromCSV(text);
        appendNumbers(numbers);
      } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
        // Parse Excel using basic XLSX parsing
        const buffer = await file.arrayBuffer();
        const numbers = extractNumbersFromXLSX(buffer);
        appendNumbers(numbers);
      } else {
        setError("Unsupported file type. Please use .csv or .xlsx files.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read spreadsheet.");
    }
  }

  function extractNumbersFromCSV(text: string): string[] {
    const numbers: string[] = [];
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      // Take the first column (split by comma, semicolon, or tab)
      const cols = line.split(/[,;\t]/);
      const cell = (cols[0] ?? "").trim().replace(/["']/g, "");
      const cleaned = cell.replace(/[\s\-().+]/g, "");
      // Only keep if it looks like a phone number (7+ digits)
      if (/^\d{7,15}$/.test(cleaned)) {
        numbers.push(cleaned);
      } else if (/^\+?\d{7,15}$/.test(cell.replace(/[\s\-()]/g, ""))) {
        numbers.push(cell.replace(/[^\d]/g, ""));
      }
    }
    return numbers;
  }

  function extractNumbersFromXLSX(buffer: ArrayBuffer): string[] {
    // Simple XLSX parser — XLSX files are ZIP archives with shared strings XML
    // For a robust solution, a library like SheetJS would be ideal,
    // but we'll do basic extraction for the first column
    const numbers: string[] = [];
    try {
      const uint8 = new Uint8Array(buffer);
      // Convert to string and look for phone-number-like patterns
      const decoder = new TextDecoder("utf-8", { fatal: false });
      const text = decoder.decode(uint8);
      
      // Extract numbers from XML content (shared strings or inline)
      const matches = text.matchAll(/<t[^>]*>([^<]+)<\/t>/g);
      for (const match of matches) {
        const cell = match[1].trim();
        const cleaned = cell.replace(/[\s\-().+]/g, "");
        if (/^\d{7,15}$/.test(cleaned)) {
          numbers.push(cleaned);
        }
      }
      
      // Also try number cells (stored as <v>94771234567</v>)
      const valMatches = text.matchAll(/<v>(\d{7,15})<\/v>/g);
      for (const match of valMatches) {
        const num = match[1];
        if (!numbers.includes(num)) {
          numbers.push(num);
        }
      }
    } catch {
      throw new Error("Could not parse XLSX file. Try saving as CSV instead.");
    }
    
    if (numbers.length === 0) {
      throw new Error("No phone numbers found in the file. Make sure numbers are in the first column (7-15 digits).");
    }
    return numbers;
  }

  function appendNumbers(numbers: string[]) {
    if (numbers.length === 0) {
      setError("No valid phone numbers found in the file.");
      return;
    }
    const existing = manualNumbers.trim();
    const newText = existing
      ? `${existing}\n${numbers.join("\n")}`
      : numbers.join("\n");
    setManualNumbers(newText);
    setError(null);
  }

  async function sendBroadcast() {
    if (!shopId) return;
    if (recipients.length === 0) {
      setError("No recipients selected.");
      return;
    }
    if (messageType === "template" && !selectedTemplate) {
      setError("Please select a template.");
      return;
    }
    if (messageType === "text" && !customText.trim()) {
      setError("Please enter a message.");
      return;
    }

    setSending(true);
    setError(null);
    setResult(null);

    try {
      const metaT = metaTemplates.find((t) => t.name === selectedTemplate);
      const fallbackT = TEMPLATE_OPTIONS.find((t) => t.id === selectedTemplate);
      const templateLang = metaT?.language || fallbackT?.language || "en";
      const res = await fetch("/api/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone_numbers: recipients,
          template_name: messageType === "template" ? selectedTemplate : undefined,
          language: messageType === "template" ? templateLang : undefined,
          custom_text: messageType === "text" ? customText.trim() : undefined,
          shop_id: shopId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Broadcast failed");
      } else {
        setResult(data);
      }
    } catch {
      setError("Network error: broadcast failed.");
    } finally {
      setSending(false);
    }
  }

  function formatDate(iso: string) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    const now = Date.now();
    const diff = now - d.getTime();
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString();
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
            Bulk Broadcast
          </h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Send template messages to multiple customers at once.
          </p>
        </div>
        <Link
          href="/messages"
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
        >
          ← Back to Messages
        </Link>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
          <button type="button" onClick={() => setError(null)} className="ml-2 font-medium underline">
            Dismiss
          </button>
        </div>
      )}

      {result && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm">
          <div className="flex items-center gap-2 text-emerald-800 font-semibold">
            ✅ Broadcast Complete
          </div>
          <div className="mt-2 grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-emerald-700">{result.sent}</div>
              <div className="text-xs text-emerald-600">Sent</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-red-600">{result.failed}</div>
              <div className="text-xs text-red-500">Failed</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-zinc-700">{result.total}</div>
              <div className="text-xs text-zinc-500">Total</div>
            </div>
          </div>
          {result.errors.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-red-600 font-medium">
                View {result.errors.length} error(s)
              </summary>
              <div className="mt-2 max-h-32 overflow-y-auto rounded-lg bg-white border border-red-100 p-2 text-xs">
                {result.errors.map((e, i) => (
                  <div key={i} className="py-0.5">
                    <span className="font-mono">{e.phone}</span>: {e.error || "Unknown error"}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: Audience Selection */}
        <div className="rounded-2xl border border-[var(--color-border-card)] bg-[var(--color-surface)] p-5 shadow-sm">
          <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)]">
            1. Select Audience
          </h2>
          <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
            Choose which customers to send the broadcast to.
          </p>

          {/* Filter tabs */}
          <div className="mt-4 flex flex-wrap gap-1.5">
            {[
              { key: "all", label: "All Contacts" },
              { key: "recent_7d", label: "Active (7d)" },
              { key: "recent_30d", label: "Active (30d)" },
              { key: "inactive_30d", label: "Inactive (30d+)" },
            ].map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => {
                  if (f.key === "manual") {
                    setManualWarningOpen(true);
                    return;
                  }
                  setFilterMode(f.key as FilterMode);
                  setSelectedPhones(new Set());
                }}
                className={[
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  filterMode === f.key
                    ? "bg-[var(--color-accent)] text-white shadow-sm"
                    : "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]",
                ].join(" ")}
              >
                {f.label}
              </button>
            ))}
          </div>

          {filterMode === "manual" ? (
            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">
                  Enter phone numbers (one per line, or comma-separated)
                </label>
                <textarea
                  value={manualNumbers}
                  onChange={(e) => setManualNumbers(e.target.value)}
                  rows={6}
                  placeholder={"94771234567\n94772345678\n94773456789"}
                  className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-3 py-2.5 text-sm font-mono outline-none focus:border-[var(--color-accent)] resize-y"
                />
                <div className="mt-1.5 text-xs text-[var(--color-text-tertiary)]">
                  {recipients.length} number{recipients.length !== 1 ? "s" : ""} entered
                </div>
              </div>

              {/* Spreadsheet upload */}
              <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">Import from spreadsheet</p>
                    <p className="text-[11px] text-[var(--color-text-tertiary)]">
                      Upload a .csv or .xlsx file. Numbers are extracted from the first column.
                    </p>
                  </div>
                </div>
                <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100 transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Choose File (.csv, .xlsx)
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleSpreadsheetUpload(file);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>
            </div>
          ) : (
            <>
              {/* Search */}
              <div className="mt-3">
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by name or number..."
                  className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
                />
              </div>

              {/* Select all / deselect */}
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-[var(--color-text-tertiary)]">
                  {filteredContacts.length} contact{filteredContacts.length !== 1 ? "s" : ""}
                  {selectedPhones.size > 0 && ` · ${selectedPhones.size} selected`}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={selectAll}
                    className="text-xs font-medium text-[var(--color-accent)] hover:underline"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={deselectAll}
                    className="text-xs font-medium text-[var(--color-text-tertiary)] hover:underline"
                  >
                    Deselect
                  </button>
                </div>
              </div>

              {/* Contact list */}
              <div className="mt-2 max-h-[320px] overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)]">
                {loading ? (
                  <div className="flex items-center justify-center py-10 text-sm text-[var(--color-text-tertiary)]">
                    Loading contacts...
                  </div>
                ) : filteredContacts.length === 0 ? (
                  <div className="flex items-center justify-center py-10 text-sm text-[var(--color-text-tertiary)]">
                    No contacts found
                  </div>
                ) : (
                  filteredContacts.map((contact) => {
                    const isSelected = selectedPhones.size === 0 || selectedPhones.has(contact.phone);
                    return (
                      <label
                        key={contact.phone}
                        className={[
                          "flex items-center gap-3 px-3 py-2.5 border-b border-[var(--color-border)] last:border-b-0 cursor-pointer transition-colors",
                          isSelected && selectedPhones.size > 0
                            ? "bg-[var(--color-accent-light)]"
                            : "hover:bg-[var(--color-surface-hover)]",
                        ].join(" ")}
                      >
                        <input
                          type="checkbox"
                          checked={selectedPhones.size === 0 ? true : selectedPhones.has(contact.phone)}
                          onChange={() => togglePhone(contact.phone)}
                          className="h-4 w-4 rounded border-zinc-300 text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                              {contact.name || contact.phone}
                            </span>
                            {contact.name && (
                              <span className="text-[11px] text-[var(--color-text-tertiary)] font-mono">
                                {contact.phone}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-[var(--color-text-tertiary)]">
                            Last active: {formatDate(contact.lastMessageAt)} · {contact.messageCount} msg{contact.messageCount !== 1 ? "s" : ""}
                          </div>
                        </div>
                      </label>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>

        {/* Right: Message Composition */}
        <div className="rounded-2xl border border-[var(--color-border-card)] bg-[var(--color-surface)] p-5 shadow-sm">
          <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)]">
            2. Compose Message
          </h2>
          <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
            Template messages work outside the 24h window. Custom text only works for recently active contacts.
          </p>

          {/* Message type toggle */}
          <div className="mt-4 flex items-center gap-3">
            <div className="inline-flex rounded-xl bg-[var(--color-surface-secondary)] p-1">
              <button
                type="button"
                onClick={() => setMessageType("template")}
                className={[
                  "rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all",
                  messageType === "template"
                    ? "bg-white text-[var(--color-text-primary)] shadow-sm"
                    : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]",
                ].join(" ")}
              >
                Template
              </button>
              <button
                type="button"
                onClick={() => setCustomTextPopup(true)}
                className="rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
              >
                Custom Text
              </button>
            </div>
            <Link
              href="/messages/templates"
              className="text-xs font-medium text-[var(--color-accent)] hover:underline"
            >
              Manage Templates →
            </Link>
          </div>

          {messageType === "template" ? (
            <div className="mt-4 space-y-3">
              <label className="block text-xs font-medium text-[var(--color-text-secondary)]">
                Select Template
              </label>
              <select
                value={selectedTemplate}
                onChange={(e) => setSelectedTemplate(e.target.value)}
                className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-3 py-2.5 text-sm outline-none focus:border-[var(--color-accent)] appearance-none"
              >
                <option value="">Choose a template...</option>
                {metaTemplates.length > 0
                  ? metaTemplates.map((t) => (
                      <option key={`${t.name}-${t.language}`} value={t.name}>
                        {t.name} ({t.language})
                      </option>
                    ))
                  : TEMPLATE_OPTIONS.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
              </select>
              {selectedTemplate && (
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-3 py-2.5">
                  <div className="text-xs font-medium text-[var(--color-text-primary)]">
                    {selectedTemplate}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--color-text-tertiary)]">
                    {metaTemplates.find((t) => t.name === selectedTemplate)?.components
                      .filter((c) => c.type === "BODY")
                      .map((c) => c.text)
                      .join("") || "Approved template"}
                  </div>
                </div>
              )}
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
                  ⚡ Template messages can reach customers even after the 24h window.
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <label className="block text-xs font-medium text-[var(--color-text-secondary)]">
                Message Text
              </label>
              <textarea
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                rows={5}
                maxLength={4096}
                placeholder="Type your message here..."
                className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-3 py-2.5 text-sm outline-none focus:border-[var(--color-accent)] resize-y"
              />
              <div className="text-right text-[11px] text-[var(--color-text-tertiary)]">
                {customText.length}/4096
              </div>
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
                ⚠️ Custom text only works for contacts who messaged in the last 24 hours. For others, use a template.
              </div>
            </div>
          )}

          {/* Summary & Send */}
          <div className="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                  Ready to send
                </div>
                <div className="text-xs text-[var(--color-text-tertiary)]">
                  {recipients.length} recipient{recipients.length !== 1 ? "s" : ""}
                  {" · "}
                  {messageType === "template"
                    ? (selectedTemplate || "No template selected")
                    : `${customText.length} characters`}
                </div>
              </div>
              <button
                type="button"
                disabled={sending || recipients.length === 0}
                onClick={() => void sendBroadcast()}
                className={[
                  "rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all",
                  sending || recipients.length === 0
                    ? "bg-gray-400 cursor-not-allowed"
                    : "bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-dark)] hover:opacity-90 shadow-sm",
                ].join(" ")}
              >
                {sending ? (
                  <span className="flex items-center gap-2">
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Sending...
                  </span>
                ) : (
                  `Send Broadcast`
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Custom Text Redirect Popup */}
      {customTextPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-sm rounded-2xl border border-indigo-200 bg-white p-6 shadow-2xl text-center">
            <div className="text-4xl">✨</div>
            <h3 className="mt-3 text-lg font-bold text-gray-900">Custom Text Broadcasts</h3>
            <p className="mt-2 text-sm text-gray-600">
              Send custom text messages to your contacts using <strong>Velo AI Bulk Pro</strong> — with scheduling, labels, and advanced targeting.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <a
                href="https://bulk.veloai.pro"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
              >
                Go to Velo AI Bulk Pro →
              </a>
              <button
                type="button"
                onClick={() => setCustomTextPopup(false)}
                className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Pro Promo */}
      <div className="mt-8 rounded-2xl border border-indigo-500/30 bg-gradient-to-br from-indigo-500/10 via-violet-500/5 to-transparent p-6 text-center">
        <div className="mx-auto max-w-md">
          <div className="text-3xl">🚀</div>
          <h3 className="mt-2 text-lg font-bold text-[var(--color-text-primary)]">Need more power?</h3>
          <p className="mt-1.5 text-sm text-[var(--color-text-secondary)]">
            Unlock advanced bulk messaging with CRM labels, scheduled campaigns, contact scraping, and analytics with <strong>Velo AI Bulk Pro</strong>.
          </p>
          <a
            href="https://bulk.veloai.pro"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 hover:opacity-90 transition-opacity"
          >
            Try Velo AI Bulk Pro
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
          </a>
        </div>
      </div>

      {/* Manual Entry Warning Modal */}
      {manualWarningOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-red-100">
                <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Account Ban Risk</h3>
                <p className="text-sm text-gray-500">Please read carefully before proceeding</p>
              </div>
            </div>

            <div className="mt-4 space-y-3 text-sm text-gray-700">
              <p>
                Sending messages to numbers that <strong>haven&apos;t contacted your business first</strong> violates WhatsApp&apos;s Business Policy and may result in:
              </p>
              <ul className="list-disc space-y-1.5 pl-5 text-gray-600">
                <li>Your WhatsApp Business account being <strong className="text-red-600">permanently banned</strong></li>
                <li>Phone number quality rating dropping to <strong className="text-red-600">Low</strong></li>
                <li>Messaging limits being restricted</li>
                <li>Business verification being revoked</li>
              </ul>
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800">
                <strong>Only proceed if</strong> you are 100% sure these numbers have opted in to receive messages from your business (e.g. they gave consent via a form, in person, or messaged you on another channel).
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setManualWarningOpen(false)}
                className="flex-1 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setManualWarningOpen(false);
                  setFilterMode("manual");
                  setSelectedPhones(new Set());
                }}
                className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 transition-colors"
              >
                I understand the risk
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
