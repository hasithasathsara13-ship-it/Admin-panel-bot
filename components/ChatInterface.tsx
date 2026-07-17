"use client";

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useLayoutEffect,
} from "react";
import { createPortal } from "react-dom";
import {
  Search,
  MoreVertical,
  Plus,
  Send,
  ArrowLeft,
  Phone,
  Video,
  Smile,
  Check,
  CheckCheck,
  Loader2,
  RefreshCw,
  ImageOff,
  Mic,
  Reply,
  Pencil,
  Trash2,
  UserPlus,
  X,
  Bot,
  FileText,
  Clock,
  Star,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { getActiveShopId } from "../lib/activeShopId";
import {
  loadSavedContacts,
  persistContactName,
  type SavedContactsMap,
} from "../lib/chatSavedContacts";
import {
  formatMessageListPreview,
  parseWhatsAppMediaContent,
} from "@/lib/whatsappMediaContent";
import { filterRedundantVoiceTranscripts } from "@/lib/whatsappWebhookInbound";
import { WaForwardAttachment, WaMediaAttachment } from "./WaMediaAttachment";
import type { RealtimeChannel } from "@supabase/supabase-js";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

/** Fallback template if Meta API templates haven't loaded yet. */
const FALLBACK_TEMPLATES = [
  { id: "hello_world", name: "Hello World", description: "Default Meta test template", language: "en_US" },
];

/** Extended when DB has reply/edit + WhatsApp id columns (see backend/supabase/messages_chat_enhancements.sql). */
const MSG_SELECT_EXTENDED =
  "id, role, content, created_at, reply_to_id, reply_snippet, edited_at, wa_message_id, delivery_status";
const MSG_SELECT_BASIC = "id, role, content, created_at";

function isMissingChatColumnsError(err: { message?: string } | null): boolean {
  const m = (err?.message ?? "").toLowerCase();
  return (
    m.includes("reply_to_id") ||
    m.includes("reply_snippet") ||
    m.includes("edited_at") ||
    m.includes("wa_message_id") ||
    m.includes("delivery_status")
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type MsgStatus = "sending" | "sent" | "delivered" | "read" | "error";

interface Message {
  id: string;
  sender: "customer" | "ai";
  content: string;
  time: string;        // formatted display time
  isoTime: string;     // ISO string for cursor-based pagination
  status?: MsgStatus;  // only set for optimistic messages
  deliveryStatus?: "sent" | "delivered" | "read" | null; // from DB column
  replyToId?: string | null;
  replySnippet?: string | null;
  editedAt?: string | null;
  /** Meta Cloud API id from last send; used to edit the bubble on the customer's WhatsApp. */
  waMessageId?: string | null;
}

interface Conversation {
  phone: string;       // phone_number (also used as ID)
  lastMessage: string;
  isoTimestamp: string;
  unread: number;
}

/** Latest DB timestamp in the thread (ignores optimistic temp ids). */
function maxCommittedIso(msgs: Message[]): string {
  let max = "1970-01-01T00:00:00.000Z";
  for (const m of msgs) {
    if (String(m.id).startsWith("opt-")) continue;
    if (m.isoTime > max) max = m.isoTime;
  }
  return max;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffDays >= 2) return d.toLocaleDateString([], { month: "short", day: "numeric" });
  if (diffDays === 1) return "Yesterday";
  if (diffHours >= 1) return `${diffHours}h ago`;
  if (diffMins >= 1) return `${diffMins}m ago`;
  return "Just now";
}

function fmtBubbleTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function phoneInitials(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.slice(-2).padStart(2, "?");
}

/** Browsers often omit `file.type` or use `image/x-png` — normalize for picker + Supabase. */
function resolvePickerImageMime(file: File): "image/jpeg" | "image/png" | "image/webp" | null {
  const raw = file.type.toLowerCase().trim();
  if (raw === "image/x-png" || raw === "image/png") return "image/png";
  if (raw === "image/jpg" || raw === "image/jpeg" || raw === "image/pjpeg") return "image/jpeg";
  if (raw === "image/webp") return "image/webp";
  const name = file.name.toLowerCase();
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".jpe")) return "image/jpeg";
  if (name.endsWith(".webp")) return "image/webp";
  if (!raw || raw === "application/octet-stream") {
    if (name.endsWith(".png")) return "image/png";
    if (name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".jpe")) return "image/jpeg";
    if (name.endsWith(".webp")) return "image/webp";
  }
  return null;
}

/**
 * WhatsApp Cloud API rejects WebM and flaky browser `audio/mp4`; `/api/admin-send-media`
 * always re-encodes voice to AAC-in-M4A via FFmpeg before upload.
 */
function audioFileForWhatsApp(blob: Blob): File | null {
  const t = (blob.type || "").toLowerCase();
  if (t.includes("webm")) {
    return new File([blob], `voice-${Date.now()}.webm`, {
      type: blob.type || "audio/webm",
    });
  }

  const fromName = (name: string): { ext: string; mime: string } | null => {
    const n = name.toLowerCase();
    if (n.endsWith(".ogg") || n.endsWith(".opus")) return { ext: "ogg", mime: "audio/ogg" };
    if (n.endsWith(".m4a")) return { ext: "m4a", mime: "audio/mp4" };
    if (n.endsWith(".mp4")) return { ext: "m4a", mime: "audio/mp4" };
    if (n.endsWith(".mp3")) return { ext: "mp3", mime: "audio/mpeg" };
    if (n.endsWith(".aac")) return { ext: "aac", mime: "audio/aac" };
    if (n.endsWith(".amr")) return { ext: "amr", mime: "audio/amr" };
    return null;
  };

  const outName = (ext: string) =>
    blob instanceof File && blob.name ? blob.name : `voice-${Date.now()}.${ext}`;

  if (t.includes("ogg") || t.includes("opus") || t.startsWith("audio/ogg")) {
    return new File([blob], outName("ogg"), { type: "audio/ogg" });
  }
  if (t.includes("mp4") || t.includes("m4a")) {
    return new File([blob], outName("m4a"), { type: "audio/mp4" });
  }
  if (t.startsWith("audio/mpeg") || t === "audio/mp3") {
    return new File([blob], outName("mp3"), { type: "audio/mpeg" });
  }
  if (t.startsWith("audio/aac")) {
    return new File([blob], outName("aac"), { type: "audio/aac" });
  }
  if (t.startsWith("audio/amr")) {
    return new File([blob], outName("amr"), { type: "audio/amr" });
  }

  if (blob instanceof File && blob.name) {
    const inferred = fromName(blob.name);
    if (inferred) {
      return new File([blob], blob.name, { type: inferred.mime });
    }
  }
  return null;
}

// Detect media type from content
type MediaKind = "image" | "audio" | "text";
const IMAGE_EXT = /\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i;
const AUDIO_EXT = /\.(mp3|ogg|wav|m4a|opus|aac|webm)(\?.*)?$/i;

function messageSnippetForReply(m: Pick<Message, "content">): string {
  const c = m.content.trim();
  if (c.startsWith("wa-media:")) {
    if (c.includes(":image")) return "📷 Photo";
    if (c.includes(":audio")) return "🎤 Voice message";
    if (c.includes(":document")) return "📄 Document";
    if (c.includes(":video")) return "🎬 Video";
    return "📎 Media";
  }
  const wa = parseWhatsAppMediaContent(c);
  if (wa.kind === "bot_transcription") return "🎤 Voice message";
  if (wa.kind === "media_id") {
    if (wa.hint === "image") return "📷 Photo";
    if (wa.hint === "audio") return "🎤 Voice message";
    return "📎 Media";
  }
  if (wa.kind === "forward_url") return "📎 Media";
  try {
    const u = new URL(c);
    if (IMAGE_EXT.test(u.pathname)) return "📷 Photo";
    if (AUDIO_EXT.test(u.pathname)) return "🎤 Audio";
  } catch {
    /* plain text */
  }
  const t = c.replace(/\s+/g, " ");
  return t.length > 72 ? `${t.slice(0, 72)}…` : t;
}

function canEditMessage(m: Message): boolean {
  if (m.sender !== "ai") return false;
  if (String(m.id).startsWith("opt-")) return false;
  const c = m.content.trim();
  if (c.startsWith("wa-media:")) return false;
  const wa = parseWhatsAppMediaContent(c);
  if (wa.kind === "media_id" || wa.kind === "forward_url") return false;
  return detectMedia(c) === "text";
}

type MessageMenuAnchor = {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

function domRectToAnchor(r: DOMRectReadOnly): MessageMenuAnchor {
  return {
    top: r.top,
    left: r.left,
    right: r.right,
    bottom: r.bottom,
    width: r.width,
    height: r.height,
  };
}

/** Full-screen overlay + fixed menu in `document.body` so it is not clipped or stacked under other bubbles. */
function MessageMenuLayer({
  message,
  anchor,
  isAI,
  onClose,
  onReply,
  onEdit,
  onDelete,
}: {
  message: Message;
  anchor: MessageMenuAnchor;
  isAI: boolean;
  onClose: () => void;
  onReply: (m: Message) => void;
  onEdit: (m: Message) => void;
  onDelete: (m: Message) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const computePos = useCallback(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = isAI ? anchor.right - mw : anchor.left;
    left = Math.max(pad, Math.min(left, vw - mw - pad));
    let top = anchor.bottom + pad;
    if (top + mh > vh - pad) {
      top = anchor.top - mh - pad;
    }
    top = Math.max(pad, Math.min(top, vh - mh - pad));
    setPos({ left, top });
  }, [anchor, isAI]);

  useLayoutEffect(() => {
    computePos();
  }, [computePos]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const ro = new ResizeObserver(() => computePos());
    ro.observe(menu);
    const onWin = () => computePos();
    window.addEventListener("resize", onWin);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onWin);
    };
  }, [computePos]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <button
        type="button"
        className="fixed inset-0 z-[10000] cursor-default bg-transparent"
        aria-label="Close menu"
        onClick={onClose}
      />
      <div
        ref={menuRef}
        role="menu"
        aria-label="Message options"
        className="fixed z-[10001] min-w-[9.5rem] rounded-lg border border-[var(--color-border-card)] bg-[var(--color-surface-solid)] py-1 shadow-lg text-[13px]"
        style={
          pos
            ? { left: pos.left, top: pos.top }
            : { left: -99999, top: 0, visibility: "hidden" as const }
        }
      >
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[var(--color-surface-hover)]"
          role="menuitem"
          onClick={() => {
            onClose();
            onReply(message);
          }}
        >
          <Reply className="w-3.5 h-3.5" />
          Reply
        </button>
        {canEditMessage(message) ? (
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[var(--color-surface-hover)]"
            role="menuitem"
            onClick={() => {
              onClose();
              onEdit(message);
            }}
          >
            <Pencil className="w-3.5 h-3.5" />
            Edit
          </button>
        ) : null}
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-[var(--color-danger)] hover:bg-[var(--color-danger-light)]"
          role="menuitem"
          onClick={() => {
            onClose();
            onDelete(message);
          }}
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete
        </button>
      </div>
    </>,
    document.body,
  );
}

function detectMedia(content: string): MediaKind {
  try {
    const url = new URL(content.trim());
    if (IMAGE_EXT.test(url.pathname)) return "image";
    if (AUDIO_EXT.test(url.pathname)) return "audio";
  } catch {
    // not a URL — plain text
  }
  return "text";
}

// Map DB row → Message
// role === 'user'            → LEFT  (customer / gray bubble)
// role === 'model' | 'admin' → RIGHT (ai / purple bubble)
/** Oldest first; same timestamp → customer message before shop/AI reply. */
function compareMessagesChronologically(a: Message, b: Message): number {
  const byTime = a.isoTime.localeCompare(b.isoTime);
  if (byTime !== 0) return byTime;
  const rank = (m: Message) => (m.sender === "customer" ? 0 : 1);
  const byRole = rank(a) - rank(b);
  if (byRole !== 0) return byRole;
  return a.id.localeCompare(b.id);
}

function sortMessagesChronologically(msgs: Message[]): Message[] {
  return [...msgs].sort(compareMessagesChronologically);
}

/** Hidden system markers that must never render as chat bubbles. */
function isHiddenMarkerMessage(content: string): boolean {
  const c = content.trim();
  return c.startsWith("[ORDER_CANCELLED]");
}

function rowToMessage(row: Record<string, unknown>): Message {
  const iso = String(row.created_at ?? new Date().toISOString());
  const role = String(row.role ?? "");
  const ds = row.delivery_status != null ? String(row.delivery_status) : null;
  return {
    id: String(row.id),
    sender: role === "user" ? "customer" : "ai",
    content: String(row.content ?? ""),
    time: fmtBubbleTime(iso),
    isoTime: iso,
    status: "sent",
    deliveryStatus: (ds === "read" || ds === "delivered" || ds === "sent") ? ds : null,
    replyToId: row.reply_to_id ? String(row.reply_to_id) : null,
    replySnippet:
      row.reply_snippet != null && String(row.reply_snippet).trim()
        ? String(row.reply_snippet)
        : null,
    editedAt: row.edited_at ? String(row.edited_at) : null,
    waMessageId:
      row.wa_message_id != null && String(row.wa_message_id).trim()
        ? String(row.wa_message_id)
        : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MediaContent — renders text, image, or audio inline
// ─────────────────────────────────────────────────────────────────────────────

function VoiceNoteTranscriptionBlock({ isAI }: { isAI: boolean }) {
  const sub = "text-[var(--wa-bubble-meta)]";
  const title = isAI
    ? "text-[var(--wa-bubble-out-text)]"
    : "text-[var(--wa-bubble-in-text)]";
  return (
    <div className="min-w-[12rem] max-w-full">
      <div
        className={[
          "flex items-center gap-2 rounded-xl px-2 py-2",
          isAI ? "bg-black/5" : "bg-black/[0.06]",
        ].join(" ")}
      >
        <Mic className={["h-4 w-4 shrink-0", sub].join(" ")} />
        <span className={["text-[13px] font-medium", title].join(" ")}>Voice message</span>
      </div>
      <p className={["mt-1.5 text-[11px] leading-snug", sub].join(" ")}>
        Recording not available — your WhatsApp bot saved text only. Point Meta&apos;s webhook to
        this app, or send a new voice note after that is set up.
      </p>
    </div>
  );
}

function MediaContent({ content, isAI }: { content: string; isAI: boolean }) {
  const textClass = isAI
    ? "text-[var(--wa-bubble-out-text)]"
    : "text-[var(--wa-bubble-in-text)]";
  const wa = parseWhatsAppMediaContent(content);
  if (wa.kind === "bot_transcription") {
    return <VoiceNoteTranscriptionBlock isAI={isAI} />;
  }
  if (wa.kind === "media_id") {
    return (
      <div className="min-w-0 max-w-full">
        {wa.caption ? (
          <p className={["text-[13.5px] leading-relaxed whitespace-pre-wrap break-words mb-1.5", textClass].join(" ")}>
            {wa.caption}
          </p>
        ) : null}
        <WaMediaAttachment mediaId={wa.mediaId} hint={wa.hint} isAI={isAI} />
      </div>
    );
  }
  if (wa.kind === "forward_url") {
    return <WaForwardAttachment forwardUrl={wa.url} isAI={isAI} />;
  }

  const kind = detectMedia(content);
  const [imgError, setImgError] = useState(false);

  if (kind === "image") {
    return imgError ? (
      <div className="flex items-center gap-1.5 text-[12px] opacity-60 py-1">
        <ImageOff className="w-4 h-4" />
        <span>Image unavailable</span>
      </div>
    ) : (
      <img
        src={content.trim()}
        alt="Shared image"
        onError={() => setImgError(true)}
        className="mt-1 w-full max-w-full max-h-[min(55dvh,26rem)] rounded-lg border border-black/10 object-contain"
        loading="lazy"
      />
    );
  }

  if (kind === "audio") {
    return (
      <div
        className={[
          "flex items-center gap-2 mt-1 px-1 py-1 rounded-xl",
          isAI ? "bg-black/5" : "bg-black/[0.06]",
        ].join(" ")}
      >
        <Mic
          className={["w-4 h-4 flex-shrink-0", isAI ? "text-[var(--wa-bubble-meta)]" : "text-[var(--wa-bubble-meta)]"].join(" ")}
        />
        <audio
          controls
          src={content.trim()}
          className="h-8 flex-1 min-w-0"
          style={{ colorScheme: "light" }}
        />
      </div>
    );
  }

  // Plain text (default) — split on || delimiter so raw symbols are never shown
  const parts = content.split("|").filter(Boolean);
  // In practice the DB stores "||" as separator, so splitting on "|" may yield
  // empty strings between the two pipes — filter(Boolean) removes them.
  // If there is only a single part (no delimiter), render as-is.
  if (parts.length <= 1) {
    return (
      <p className={["text-[13.5px] leading-relaxed whitespace-pre-wrap break-words", textClass].join(" ")}>
        {content}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {parts.map((part, i) => (
        <p key={i} className={["text-[13.5px] leading-relaxed whitespace-pre-wrap break-words", textClass].join(" ")}>
          {part.trim()}
        </p>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ChatBubble (WhatsApp-style)
// ─────────────────────────────────────────────────────────────────────────────

function ChatBubble({
  msg,
  onOpenMessageMenu,
}: {
  msg: Message;
  onOpenMessageMenu: (rect: DOMRectReadOnly) => void;
}) {
  const isAI = msg.sender === "ai";
  const isSending = msg.status === "sending";
  const isError = msg.status === "error";
  const committed = !String(msg.id).startsWith("opt-");
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const docListenersRef = useRef<{
    move: (ev: PointerEvent) => void;
    end: (ev: PointerEvent) => void;
  } | null>(null);
  const onOpenMenuRef = useRef(onOpenMessageMenu);
  onOpenMenuRef.current = onOpenMessageMenu;

  const removeDocListeners = useCallback(() => {
    const h = docListenersRef.current;
    if (h) {
      document.removeEventListener("pointermove", h.move);
      document.removeEventListener("pointerup", h.end);
      document.removeEventListener("pointercancel", h.end);
      docListenersRef.current = null;
    }
  }, []);

  const cancelLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
  }, []);

  const clearLongPress = useCallback(() => {
    cancelLongPressTimer();
    removeDocListeners();
  }, [cancelLongPressTimer, removeDocListeners]);

  useEffect(() => {
    return () => {
      cancelLongPressTimer();
      removeDocListeners();
    };
  }, [cancelLongPressTimer, removeDocListeners]);

  const LONG_PRESS_MS = 500;
  const LONG_PRESS_MOVE_CANCEL_PX = 12;

  const startLongPress = useCallback(
    (clientX: number, clientY: number) => {
      if (!committed) return;
      cancelLongPressTimer();
      longPressStartRef.current = { x: clientX, y: clientY };
      longPressTimerRef.current = setTimeout(() => {
        longPressTimerRef.current = null;
        longPressStartRef.current = null;
        removeDocListeners();
        const el = bubbleRef.current;
        if (!el) return;
        onOpenMenuRef.current(el.getBoundingClientRect());
      }, LONG_PRESS_MS);
    },
    [committed, cancelLongPressTimer, removeDocListeners]
  );

  const maybeCancelLongPressByMove = useCallback(
    (clientX: number, clientY: number) => {
      const start = longPressStartRef.current;
      if (!start) return;
      const dx = clientX - start.x;
      const dy = clientY - start.y;
      if (dx * dx + dy * dy > LONG_PRESS_MOVE_CANCEL_PX * LONG_PRESS_MOVE_CANCEL_PX) {
        clearLongPress();
      }
    },
    [clearLongPress]
  );

  return (
    <div
      className={[
        "flex w-full animate-fade-in px-1",
        isAI ? "justify-end pl-10" : "justify-start pr-10",
      ].join(" ")}
    >
      <div className="relative max-w-[85%] min-w-0 md:max-w-[68%]">
        <div
          ref={bubbleRef}
          className={[
            "min-w-0 rounded-lg px-2.5 py-1.5 shadow-[0_1px_0.5px_rgba(0,0,0,0.13)] touch-manipulation",
            isAI
              ? "bg-[var(--wa-bubble-out)] text-[var(--wa-bubble-out-text)] rounded-tr-none"
              : "bg-[var(--wa-bubble-in)] text-[var(--wa-bubble-in-text)] rounded-tl-none border border-black/[0.06]",
            isError ? "ring-2 ring-red-400/60" : "",
          ].join(" ")}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            if (!committed) return;
            const t = e.target;
            if (t instanceof Element && t.closest("audio, video")) return;
            const pid = e.pointerId;
            const move = (ev: PointerEvent) => {
              if (ev.pointerId !== pid) return;
              maybeCancelLongPressByMove(ev.clientX, ev.clientY);
            };
            const end = (ev: PointerEvent) => {
              if (ev.pointerId !== pid) return;
              clearLongPress();
            };
            removeDocListeners();
            document.addEventListener("pointermove", move);
            document.addEventListener("pointerup", end);
            document.addEventListener("pointercancel", end);
            docListenersRef.current = { move, end };
            startLongPress(e.clientX, e.clientY);
          }}
        >
          {msg.replySnippet ? (
            <div
              className={[
                "mb-1.5 border-l-[3px] pl-2 text-[11.5px] leading-snug opacity-90",
                isAI ? "border-[#008069]" : "border-[#008069]",
              ].join(" ")}
            >
              {msg.replySnippet}
            </div>
          ) : null}

          <MediaContent content={msg.content} isAI={isAI} />

          <div
            className={[
              "flex items-center gap-1 justify-end mt-0.5 -mb-0.5",
            ].join(" ")}
          >
            {msg.editedAt ? (
              <span className="text-[9px] text-[var(--wa-bubble-meta)] pr-0.5">Edited</span>
            ) : null}
            {isError ? (
              <span className="text-[10px] text-red-500">Failed</span>
            ) : null}
            <span className="text-[11px] text-[var(--wa-bubble-meta)] tabular-nums">
              {msg.time}
            </span>
            {isAI ? (
              isSending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--wa-bubble-meta)]" />
              ) : isError ? null : (
                (() => {
                  // Determine tick state: deliveryStatus from DB takes priority, fall back to optimistic status
                  const ds = msg.deliveryStatus;
                  const isRead = ds === "read";
                  const isDelivered = ds === "delivered" || isRead;
                  // Double tick = delivered or read; single tick = sent only
                  if (isDelivered) {
                    return (
                      <CheckCheck
                        className={[
                          "w-3.5 h-3.5 shrink-0",
                          isRead ? "text-[#53bdeb]" : "text-[var(--wa-bubble-meta)]",
                        ].join(" ")}
                      />
                    );
                  }
                  // Single gray tick = sent to server, not yet delivered
                  return (
                    <Check className="w-3.5 h-3.5 shrink-0 text-[var(--wa-bubble-meta)]" />
                  );
                })()
              )
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function useVoiceRecorder(onSend: (blob: Blob) => void) {
  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState<Blob | null>(null);
  const [duration, setDuration] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);

  const cleanupAudioMeter = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) {
        for (const t of streamRef.current.getTracks()) t.stop();
      }
      cleanupAudioMeter();
      recorderRef.current = null;
      chunksRef.current = [];
    };
  }, [cleanupAudioMeter]);

  const startRecording = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    const preferredMimeTypes = [
      "audio/ogg;codecs=opus",
      "audio/ogg",
      "audio/mp4;codecs=mp4a.40.2",
      "audio/mp4",
      "audio/mp4;codecs=aac",
      "audio/aac",
    ];
    let mimeType = preferredMimeTypes.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
    if (!mimeType && MediaRecorder.isTypeSupported("audio/webm")) mimeType = "audio/webm";
    if (!mimeType) {
      for (const t of stream.getTracks()) t.stop();
      window.alert("This browser cannot record audio in a supported format.");
      return;
    }

    // Set up audio level meter for the live waveform
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        // Average amplitude → normalized 0..1
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const avg = sum / dataArray.length / 255;
        setLevels((prev) => {
          const next = [...prev, Math.max(0.08, Math.min(1, avg * 2.5))];
          return next.length > 40 ? next.slice(next.length - 40) : next;
        });
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch { /* meter optional */ }

    const recorder = new MediaRecorder(stream, { mimeType });
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType });
      chunksRef.current = [];
      for (const t of stream.getTracks()) t.stop();
      cleanupAudioMeter();
      if (blob.size > 0) setRecorded(blob);
      setRecording(false);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
    recorderRef.current = recorder;
    setRecording(true);
    setDuration(0);
    setRecorded(null);
    setLevels([]);
    timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    recorder.start(250);
  }, [cleanupAudioMeter]);

  const stopRecording = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      if (typeof rec.requestData === "function") rec.requestData();
      rec.stop();
    }
  }, []);

  const discardRecording = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      recorderRef.current = null;
      rec.onstop = () => {
        chunksRef.current = [];
        if (streamRef.current) for (const t of streamRef.current.getTracks()) t.stop();
        cleanupAudioMeter();
      };
      rec.stop();
    }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    cleanupAudioMeter();
    setRecorded(null);
    setRecording(false);
    setDuration(0);
    setLevels([]);
  }, [cleanupAudioMeter]);

  const sendRecording = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/ogg" });
        chunksRef.current = [];
        if (streamRef.current) for (const t of streamRef.current.getTracks()) t.stop();
        cleanupAudioMeter();
        if (blob.size > 0) onSend(blob);
        setRecording(false);
        setRecorded(null);
        setDuration(0);
        setLevels([]);
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      };
      if (typeof rec.requestData === "function") rec.requestData();
      rec.stop();
      return;
    }
    if (recorded) {
      onSend(recorded);
      setRecorded(null);
      setDuration(0);
      setLevels([]);
    }
  }, [recorded, onSend, cleanupAudioMeter]);

  return {
    recording,
    recorded,
    duration,
    levels,
    isActive: recording || recorded !== null,
    startRecording,
    stopRecording,
    discardRecording,
    sendRecording,
  };
}

function formatVoiceTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/** Extract phone number from raw input — supports plain numbers, wa.me links, api.whatsapp.com links */
function extractPhoneFromInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Try to extract from wa.me link: https://wa.me/94771234567
  const waMe = trimmed.match(/wa\.me\/(\d+)/);
  if (waMe) return waMe[1];

  // Try to extract from api.whatsapp.com/send?phone=94771234567
  const apiWa = trimmed.match(/phone=(\d+)/);
  if (apiWa) return apiWa[1];

  // Try to extract from chat.whatsapp.com link
  const chatWa = trimmed.match(/chat\.whatsapp\.com\/.*?(\d{7,15})/);
  if (chatWa) return chatWa[1];

  // Plain number — strip everything except digits
  const digits = trimmed.replace(/[^\d]/g, "");
  if (digits.length >= 7) return digits;

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ConversationRow
// ─────────────────────────────────────────────────────────────────────────────

function ConversationRow({
  conv,
  isActive,
  onClick,
  displayLabel,
}: {
  conv: Conversation;
  isActive: boolean;
  onClick: () => void;
  displayLabel: string;
}) {
  const initials = phoneInitials(conv.phone);
  const relTime = fmtTime(conv.isoTimestamp);

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "w-full text-left px-4 py-4 flex items-center gap-4 transition-all duration-150",
        isActive ? "bg-[var(--color-accent-light)]" : "hover:bg-[var(--color-surface-hover)]",
      ].join(" ")}
    >
      <div className="relative flex-shrink-0">
        <div
          className={[
            "w-[52px] h-[52px] rounded-full flex items-center justify-center text-[15px] font-semibold text-white",
            isActive
              ? "bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-dark)]"
              : "bg-gradient-to-br from-indigo-400 to-violet-500",
          ].join(" ")}
        >
          {initials}
        </div>
      </div>

      <div className="flex-1 min-w-0 border-b border-[var(--color-border-light)] pb-4">
        <div className="flex justify-between items-baseline gap-2 mb-1">
          <span className={["text-[16px] md:text-[14px] truncate", conv.unread > 0 ? "font-bold text-[var(--color-text-primary)]" : "font-semibold text-[var(--color-text-primary)]"].join(" ")}>
            {displayLabel}
          </span>
          <span className={["text-[12px] whitespace-nowrap flex-shrink-0", conv.unread > 0 ? "text-[#25D366] font-semibold" : "text-[var(--color-text-tertiary)]"].join(" ")}>
            {relTime}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className={["text-[14px] md:text-[13px] truncate", conv.unread > 0 ? "text-[var(--color-text-primary)] font-medium" : "text-[var(--color-text-tertiary)]"].join(" ")}>
            {formatMessageListPreview(conv.lastMessage)}
          </p>
          {conv.unread > 0 && (
            <span className="flex-shrink-0 min-w-[22px] h-[22px] px-1.5 rounded-full bg-[#25D366] text-white text-[11px] font-bold flex items-center justify-center">
              {conv.unread}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main ChatInterface component
// ─────────────────────────────────────────────────────────────────────────────

export function ChatInterface() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [convsLoading, setConvsLoading] = useState(true);

  const [activePhone, setActivePhone] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgsLoading, setMsgsLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);

  const [inputText, setInputText] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [isMobileChatOpen, setIsMobileChatOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(30); // percentage
  const isResizingRef = useRef(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [savedContacts, setSavedContacts] = useState<SavedContactsMap>({});
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [saveContactOpen, setSaveContactOpen] = useState(false);
  const [contactDraft, setContactDraft] = useState("");
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newChatPhone, setNewChatPhone] = useState("");
  const [messageMenu, setMessageMenu] = useState<{
    id: string;
    anchor: MessageMenuAnchor;
    isAI: boolean;
  } | null>(null);

  // ── Bot toggle per-conversation ────────────────────────────────────────────
  const [botActive, setBotActive] = useState(true);
  const [botToggleLoading, setBotToggleLoading] = useState(false);
  const botAutoEnableTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const BOT_AUTO_ENABLE_DELAY_MS = 20 * 60 * 1000; // 20 minutes

  // ── 24-hour messaging window ───────────────────────────────────────────────
  const [isPast24Hours, setIsPast24Hours] = useState(false);
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [sendingTemplate, setSendingTemplate] = useState(false);
  const templateContainerRef = useRef<HTMLDivElement>(null);
  // Track when a template was sent to keep the input unlocked for 24h
  const templateSentAtRef = useRef<number>(0);
  // Reviews state
  const [sendingReviews, setSendingReviews] = useState(false);
  // Dynamic templates from Meta
  const [metaTemplates, setMetaTemplates] = useState<{ id: string; name: string; description: string; language: string }[]>([]);

  // shopId must be set after client mount: SSR/hydration runs the initializer with
  // no window, so a lazy localStorage read would stay null forever.
  const [shopId, setShopId] = useState<string | null>(null);
  useEffect(() => {
    setShopId(getActiveShopId());
  }, []);

  useEffect(() => {
    if (!shopId) return;
    setSavedContacts(loadSavedContacts(shopId));
  }, [shopId]);

  // Set data attribute on root element when mobile chat is open
  // This allows DashboardShell's Topbar and BottomNav to hide via CSS
  useEffect(() => {
    if (isMobileChatOpen) {
      document.documentElement.setAttribute("data-mobile-chat-open", "true");
    } else {
      document.documentElement.removeAttribute("data-mobile-chat-open");
    }
    return () => {
      document.documentElement.removeAttribute("data-mobile-chat-open");
    };
  }, [isMobileChatOpen]);

  // Fetch approved templates from Meta API
  useEffect(() => {
    if (!shopId) return;
    void (async () => {
      try {
        const res = await fetch(`/api/templates?shop_id=${encodeURIComponent(shopId)}`);
        const data = await res.json();
        if (res.ok && Array.isArray(data.templates)) {
          const approved = (data.templates as Array<{ name: string; status: string; language: string; components: Array<{ type: string; text?: string }> }>)
            .filter((t) => t.status.toUpperCase() === "APPROVED")
            .map((t) => ({
              id: t.name,
              name: t.name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
              description: t.components.find((c) => c.type === "BODY")?.text || "Approved template",
              language: t.language,
            }));
          if (approved.length > 0) setMetaTemplates(approved);
        }
      } catch { /* ignore — will use fallback */ }
    })();
  }, [shopId]);

  // ── Bot active: fetch from customers table when conversation changes ───────
  const fetchBotActive = useCallback(async (phone: string) => {
    if (!supabase || !shopId) return;
    setBotToggleLoading(true);
    const { data } = await supabase
      .from("customers")
      .select("bot_active")
      .eq("shop_id", shopId)
      .eq("phone_number", phone)
      .maybeSingle();
    // If no customer row exists yet, default to true (bot is active)
    setBotActive(data?.bot_active ?? true);
    setBotToggleLoading(false);
  }, [shopId]);

  const toggleBotActive = useCallback(async (newValue: boolean) => {
    if (!supabase || !shopId || !activePhone) return;
    setBotToggleLoading(true);
    setBotActive(newValue);

    // Upsert into customers table
    const { error } = await supabase
      .from("customers")
      .upsert(
        { shop_id: shopId, phone_number: activePhone, bot_active: newValue },
        { onConflict: "shop_id,phone_number" }
      );

    if (error) {
      console.error("[toggleBotActive]", error.message);
      setBotActive(!newValue); // revert on error
    }

    setBotToggleLoading(false);

    // If bot was disabled, start the 20-minute auto-enable timer
    if (!newValue) {
      startBotAutoEnableTimer();
    } else {
      clearBotAutoEnableTimer();
    }
  }, [shopId, activePhone]);

  const startBotAutoEnableTimer = useCallback(() => {
    clearBotAutoEnableTimer();
    botAutoEnableTimerRef.current = setTimeout(async () => {
      // Auto-enable the bot after 20 minutes
      if (!supabase || !shopId || !activePhoneRef.current) return;
      const phone = activePhoneRef.current;
      const { error } = await supabase
        .from("customers")
        .upsert(
          { shop_id: shopId, phone_number: phone, bot_active: true },
          { onConflict: "shop_id,phone_number" }
        );
      if (!error) {
        // Only update UI state if we're still viewing the same conversation
        if (activePhoneRef.current === phone) {
          setBotActive(true);
        }
      }
    }, BOT_AUTO_ENABLE_DELAY_MS);
  }, [shopId]);

  const clearBotAutoEnableTimer = useCallback(() => {
    if (botAutoEnableTimerRef.current) {
      clearTimeout(botAutoEnableTimerRef.current);
      botAutoEnableTimerRef.current = null;
    }
  }, []);

  // Clean up timer on unmount or conversation switch
  useEffect(() => {
    return () => clearBotAutoEnableTimer();
  }, [activePhone, clearBotAutoEnableTimer]);

  // ── 24-hour window check ───────────────────────────────────────────────────
  // Recalculate whenever messages change (new message arrives, conversation switch)
  useEffect(() => {
    if (!messages.length) {
      setIsPast24Hours(false);
      return;
    }

    // If a template was sent recently (within 24h), keep the window open
    const twentyFourHours = 24 * 60 * 60 * 1000;
    if (templateSentAtRef.current && Date.now() - templateSentAtRef.current < twentyFourHours) {
      setIsPast24Hours(false);
      return;
    }

    // Find the last message from the customer (role = 'user' / sender = 'customer')
    const customerMessages = messages.filter((m) => m.sender === "customer");
    if (customerMessages.length === 0) {
      // No customer messages at all — window is closed (can't send without template)
      setIsPast24Hours(true);
      return;
    }
    const lastCustomerMsg = customerMessages[customerMessages.length - 1];
    const lastCustomerTime = new Date(lastCustomerMsg.isoTime).getTime();
    const now = Date.now();
    setIsPast24Hours(now - lastCustomerTime > twentyFourHours);
  }, [messages]);

  // Re-check every minute so the UI updates when the window expires while viewing
  useEffect(() => {
    const interval = setInterval(() => {
      if (!messages.length) return;

      const twentyFourHours = 24 * 60 * 60 * 1000;
      // If a template was sent recently, keep input unlocked
      if (templateSentAtRef.current && Date.now() - templateSentAtRef.current < twentyFourHours) {
        setIsPast24Hours(false);
        return;
      }

      const customerMessages = messages.filter((m) => m.sender === "customer");
      if (customerMessages.length === 0) {
        setIsPast24Hours(true);
        return;
      }
      const lastCustomerMsg = customerMessages[customerMessages.length - 1];
      const lastCustomerTime = new Date(lastCustomerMsg.isoTime).getTime();
      setIsPast24Hours(Date.now() - lastCustomerTime > twentyFourHours);
    }, 60_000);
    return () => clearInterval(interval);
  }, [messages]);

  // Close template menu when clicking outside
  useEffect(() => {
    if (!templateMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (templateContainerRef.current && !templateContainerRef.current.contains(e.target as Node)) {
        setTemplateMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [templateMenuOpen]);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const realtimeChannelRef = useRef<RealtimeChannel | null>(null);
  const oldestCursorRef = useRef<string | null>(null);
  const prevScrollHeightRef = useRef<number>(0);
  const messagesRef = useRef<Message[]>([]);
  const activePhoneRef = useRef<string | null>(null);
  // Tracks locally-deleted message ids so polling/realtime don't re-add them
  const deletedIdsRef = useRef<Set<string>>(new Set());

  messagesRef.current = messages;
  activePhoneRef.current = activePhone;

  const openMessageMenu = useCallback(
    (id: string, rect: DOMRectReadOnly, isAI: boolean) => {
      setMessageMenu({ id, anchor: domRectToAnchor(rect), isAI });
    },
    [],
  );

  const closeMessageMenu = useCallback(() => {
    setMessageMenu(null);
  }, []);

  useEffect(() => {
    setMessageMenu(null);
  }, [activePhone]);

  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const onScroll = () => setMessageMenu(null);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!messageMenu) return;
    if (!messages.some((m) => m.id === messageMenu.id)) setMessageMenu(null);
  }, [messages, messageMenu]);

  // ─────────────────────────────────────────────────────────────────────────
  // Fetch conversation list (distinct phone_numbers with latest message)
  // ─────────────────────────────────────────────────────────────────────────

  const fetchConversations = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!supabase || !shopId) return;
      if (!opts?.silent) setConvsLoading(true);

      const { data, error } = await supabase
        .from("messages")
        .select("phone_number, content, created_at, role")
        .eq("shop_id", shopId)
        .order("created_at", { ascending: false });

      if (error || !data) {
        if (!opts?.silent) setConvsLoading(false);
        return;
      }

      // Group by phone_number, keep only the most recent row per phone
      const seen = new Map<string, Conversation>();
      for (const row of data as Record<string, unknown>[]) {
        const phone = String(row.phone_number ?? "");
        if (!phone || seen.has(phone)) continue;
        seen.set(phone, {
          phone,
          lastMessage: String(row.content ?? ""),
          isoTimestamp: String(row.created_at ?? ""),
          unread: 0,
        });
      }

      setConversations((prev) => {
        const nextList = Array.from(seen.values());
        if (opts?.silent) {
          const open = activePhoneRef.current;
          const prevByPhone = new Map(prev.map((c) => [c.phone, c]));
          // Preserve manually-added conversations (new chats with no messages yet)
          const nextPhones = new Set(nextList.map((c) => c.phone));
          const preserved = prev.filter((c) => !nextPhones.has(c.phone) && c.phone === open);
          return [...nextList.map((c) => {
            const old = prevByPhone.get(c.phone);
            let unread = old?.unread ?? 0;
            if (
              old &&
              (old.isoTimestamp !== c.isoTimestamp ||
                old.lastMessage !== c.lastMessage)
            ) {
              unread = c.phone === open ? 0 : unread + 1;
            }
            return { ...c, unread };
          }), ...preserved];
        }
        // Preserve the currently active phone if it has no messages yet
        const open = activePhoneRef.current;
        if (open && !nextList.some((c) => c.phone === open)) {
          const existing = prev.find((c) => c.phone === open);
          if (existing) return [existing, ...nextList];
        }
        return nextList;
      });
      if (!opts?.silent) setConvsLoading(false);
    },
    [shopId],
  );

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // ─────────────────────────────────────────────────────────────────────────
  // Fetch initial 50 messages for a phone_number (most recent first → reverse)
  // ─────────────────────────────────────────────────────────────────────────

  const fetchInitialMessages = useCallback(async (phone: string) => {
    if (!supabase || !shopId) return;
    setMsgsLoading(true);
    setMessages([]);
    oldestCursorRef.current = null;
    setHasOlderMessages(false);

    const q1 = await supabase
      .from("messages")
      .select(MSG_SELECT_EXTENDED)
      .eq("shop_id", shopId)
      .eq("phone_number", phone)
      .order("created_at", { ascending: false })
      .order("role", { ascending: true })
      .limit(PAGE_SIZE);

    let data = q1.data as Record<string, unknown>[] | null;
    let error = q1.error;

    if (error && isMissingChatColumnsError(error)) {
      const r2 = await supabase
        .from("messages")
        .select(MSG_SELECT_BASIC)
        .eq("shop_id", shopId)
        .eq("phone_number", phone)
        .order("created_at", { ascending: false })
        .order("role", { ascending: true })
        .limit(PAGE_SIZE);
      data = r2.data as Record<string, unknown>[] | null;
      error = r2.error;
    }

    if (error || !data) {
      setMsgsLoading(false);
      return;
    }

    // data comes newest-first from Supabase; spread into a new mutable array
    // before reversing so the read-only Supabase response is not mutated silently.
    const rows = [...(data as Record<string, unknown>[])].reverse();
    const msgs = sortMessagesChronologically(
      filterRedundantVoiceTranscripts(
        rows.map(rowToMessage).filter((m) => !isHiddenMarkerMessage(m.content)),
      ),
    );

    setMessages(msgs);
    setHasOlderMessages(data.length === PAGE_SIZE);

    if (msgs.length > 0) {
      oldestCursorRef.current = msgs[0].isoTime;
    }

    setMsgsLoading(false);
  }, [shopId]);

  // ─────────────────────────────────────────────────────────────────────────
  // Fetch next 50 OLDER messages when user scrolls to top
  // ─────────────────────────────────────────────────────────────────────────

  const fetchOlderMessages = useCallback(async () => {
    if (!supabase || !shopId || !activePhone || !oldestCursorRef.current) return;
    if (loadingOlder || !hasOlderMessages) return;

    setLoadingOlder(true);

    // Capture scroll height before prepend so we can restore position
    prevScrollHeightRef.current = messagesContainerRef.current?.scrollHeight ?? 0;

    const q1 = await supabase
      .from("messages")
      .select(MSG_SELECT_EXTENDED)
      .eq("shop_id", shopId)
      .eq("phone_number", activePhone)
      .lt("created_at", oldestCursorRef.current)
      .order("created_at", { ascending: false })
      .order("role", { ascending: true })
      .limit(PAGE_SIZE);

    let data = q1.data as Record<string, unknown>[] | null;
    let error = q1.error;

    if (error && isMissingChatColumnsError(error)) {
      const r2 = await supabase
        .from("messages")
        .select(MSG_SELECT_BASIC)
        .eq("shop_id", shopId)
        .eq("phone_number", activePhone)
        .lt("created_at", oldestCursorRef.current)
        .order("created_at", { ascending: false })
        .order("role", { ascending: true })
        .limit(PAGE_SIZE);
      data = r2.data as Record<string, unknown>[] | null;
      error = r2.error;
    }

    if (error || !data) {
      setLoadingOlder(false);
      return;
    }

    const rows = [...(data as Record<string, unknown>[])].reverse();
    const olderMsgs = rows.map(rowToMessage).filter((m) => !isHiddenMarkerMessage(m.content));

    if (olderMsgs.length > 0) {
      oldestCursorRef.current = olderMsgs[0].isoTime;
      setMessages((prev) =>
        sortMessagesChronologically(
          filterRedundantVoiceTranscripts([...olderMsgs, ...prev]),
        ),
      );
    }

    setHasOlderMessages(data.length === PAGE_SIZE);
    setLoadingOlder(false);
  }, [activePhone, loadingOlder, hasOlderMessages, shopId]);

  // Restore scroll position after older messages are prepended
  useLayoutEffect(() => {
    const container = messagesContainerRef.current;
    if (!container || !loadingOlder) return;
    const diff = container.scrollHeight - prevScrollHeightRef.current;
    container.scrollTop += diff;
  }, [messages, loadingOlder]);

  // ─────────────────────────────────────────────────────────────────────────
  // Scroll listener — fetch older when near top
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const onScroll = () => {
      if (container.scrollTop < 80 && hasOlderMessages && !loadingOlder) {
        fetchOlderMessages();
      }
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [fetchOlderMessages, hasOlderMessages, loadingOlder]);

  // ─────────────────────────────────────────────────────────────────────────
  // Auto-scroll to bottom on initial load and new messages
  // ─────────────────────────────────────────────────────────────────────────

  // Auto-scroll to bottom after initial load and on active conversation switch
  useEffect(() => {
    if (!msgsLoading) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [msgsLoading, activePhone]);

  // Auto-scroll when messages array grows (new message arrives or admin sends one)
  // Skip when we are loading older (prepend) — those restore via scroll height diff.
  const prevMsgCountRef = useRef(0);
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const newCount = messages.length;
    // Only scroll if messages were appended (count grew) and user is near bottom
    const atBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 150;

    if (newCount > prevMsgCountRef.current && !loadingOlder && atBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevMsgCountRef.current = newCount;
  }, [messages, loadingOlder]);

  // ─────────────────────────────────────────────────────────────────────────
  // Supabase Realtime — one channel per shop (activePhone via ref so we don’t
  // resubscribe on every thread switch). Ensure `messages` is in the Realtime
  // publication (see backend/supabase/enable_realtime_messages.sql).
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (realtimeChannelRef.current) {
      supabase?.removeChannel(realtimeChannelRef.current);
      realtimeChannelRef.current = null;
    }

    if (!supabase || !shopId) return;

    const channel = supabase
      .channel(`messages:shop:${shopId}`)
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
          const phone = String(row.phone_number ?? "");
          const newMsg = rowToMessage(row);
          const openPhone = activePhoneRef.current;

          // Hidden system markers (e.g. order-cancelled) must not appear in chat or sidebar.
          if (isHiddenMarkerMessage(newMsg.content)) return;
          // Skip messages the user just deleted locally
          if (deletedIdsRef.current.has(String(newMsg.id))) return;

          if (phone === openPhone) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === newMsg.id)) return prev;
              return sortMessagesChronologically(
                filterRedundantVoiceTranscripts([...prev, newMsg]),
              );
            });
          }

          setConversations((prev) => {
            const existing = prev.find((c) => c.phone === phone);
            const updated: Conversation = {
              phone,
              lastMessage: String(row.content ?? ""),
              isoTimestamp: String(row.created_at ?? ""),
              unread: phone === openPhone ? 0 : (existing?.unread ?? 0) + 1,
            };
            const others = prev.filter((c) => c.phone !== phone);
            return [updated, ...others];
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `shop_id=eq.${shopId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          const phone = String(row.phone_number ?? "");
          if (phone !== activePhoneRef.current) return;
          const next = rowToMessage(row);
          setMessages((prev) =>
            sortMessagesChronologically(
              filterRedundantVoiceTranscripts(
                prev.map((m) => (m.id === next.id ? next : m)),
              ),
            ),
          );
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "messages",
          filter: `shop_id=eq.${shopId}`,
        },
        (payload) => {
          const oldRow = payload.old as Record<string, unknown>;
          const id = oldRow?.id != null ? String(oldRow.id) : "";
          if (!id) return;
          setMessages((prev) => prev.filter((m) => m.id !== id));
        },
      )
      .subscribe((status, err) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn("[ChatInterface] Realtime:", status, err?.message ?? err);
        }
      });

    realtimeChannelRef.current = channel;

    return () => {
      supabase?.removeChannel(channel);
    };
  }, [shopId]);

  // ─────────────────────────────────────────────────────────────────────────
  // Polling fallback — catches new rows if Realtime isn’t enabled or drops events
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!supabase || !shopId || !activePhone) return;

    const sb = supabase;
    let cancelled = false;

    const syncNewMessages = async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      const latest = maxCommittedIso(messagesRef.current);
      const bootstrapping = latest <= "1970-01-02T00:00:00.000Z";

      let query = sb
        .from("messages")
        .select(MSG_SELECT_EXTENDED)
        .eq("shop_id", shopId)
        .eq("phone_number", activePhone);

      if (bootstrapping) {
        query = query
          .order("created_at", { ascending: false })
          .order("role", { ascending: true })
          .limit(PAGE_SIZE);
      } else {
        query = query
          .gt("created_at", latest)
          .order("created_at", { ascending: true })
          .order("role", { ascending: true });
      }

      const q1 = await query;
      let data = q1.data as Record<string, unknown>[] | null;
      let error = q1.error;

      if (error && isMissingChatColumnsError(error)) {
        let q2 = sb
          .from("messages")
          .select(MSG_SELECT_BASIC)
          .eq("shop_id", shopId)
          .eq("phone_number", activePhone);
        if (bootstrapping) {
          q2 = q2
            .order("created_at", { ascending: false })
            .order("role", { ascending: true })
            .limit(PAGE_SIZE);
        } else {
          q2 = q2
            .gt("created_at", latest)
            .order("created_at", { ascending: true })
            .order("role", { ascending: true });
        }
        const r2 = await q2;
        data = r2.data as Record<string, unknown>[] | null;
        error = r2.error;
      }

      if (cancelled || error || !data?.length) return;

      const rows = bootstrapping
        ? [...(data as Record<string, unknown>[])].reverse()
        : (data as Record<string, unknown>[]);
      const additions = rows
        .map(rowToMessage)
        .filter((m) => !isHiddenMarkerMessage(m.content))
        .filter((m) => !deletedIdsRef.current.has(String(m.id)));

      setMessages((prev) => {
        const byId = new Map(prev.map((m) => [m.id, m]));
        for (const a of additions) {
          if (!byId.has(a.id)) byId.set(a.id, a);
        }
        return sortMessagesChronologically(
          filterRedundantVoiceTranscripts(Array.from(byId.values())),
        );
      });
    };

    const interval = setInterval(syncNewMessages, 3500);
    const onVisible = () => syncNewMessages();
    document.addEventListener("visibilitychange", onVisible);
    void syncNewMessages();

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [supabase, shopId, activePhone]);

  useEffect(() => {
    if (!shopId) return;
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void fetchConversations({ silent: true });
      }
    }, 8000);
    return () => clearInterval(interval);
  }, [shopId, fetchConversations]);

  // ─────────────────────────────────────────────────────────────────────────
  // Select conversation
  // ─────────────────────────────────────────────────────────────────────────

  const openConversation = (phone: string) => {
    setActivePhone(phone);
    setIsMobileChatOpen(true);
    setReplyingTo(null);
    if (shopId) {
      setContactDraft(loadSavedContacts(shopId)[phone] ?? "");
    }
    // Add to conversation list if not already there
    setConversations((prev) => {
      const exists = prev.some((c) => c.phone === phone);
      if (exists) {
        return prev.map((c) => (c.phone === phone ? { ...c, unread: 0 } : c));
      }
      return [{ phone, lastMessage: "", isoTimestamp: new Date().toISOString(), unread: 0 }, ...prev];
    });
    fetchInitialMessages(phone);
    fetchBotActive(phone);
    clearBotAutoEnableTimer();
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Send message — Optimistic UI + Supabase insert
  // ─────────────────────────────────────────────────────────────────────────

  const sendMessage = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !activePhone || !shopId) return;

    const replyTarget = replyingTo;
    const replyId =
      replyTarget && !String(replyTarget.id).startsWith("opt-")
        ? replyTarget.id
        : null;
    const replySnippet = replyTarget ? messageSnippetForReply(replyTarget) : null;

    // 1. Optimistically add with "sending" status
    //    Admin/agent messages always appear on the RIGHT (sender = "ai")
    const tempId = `opt-${Date.now()}`;
    const isoNow = new Date().toISOString();
    const optimisticMsg: Message = {
      id: tempId,
      sender: "ai",   // admin sends from right (purple bubble)
      content: text,
      time: fmtBubbleTime(isoNow),
      isoTime: isoNow,
      status: "sending",
      replyToId: replyId,
      replySnippet,
    };
    setMessages((prev) => [...prev, optimisticMsg]);
    setInputText("");
    setEmojiOpen(false);
    setReplyingTo(null);
    // Immediately scroll to bottom so the new optimistic bubble is visible
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 30);
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    // 2. Insert into Supabase
    if (!supabase) {
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, status: "error" } : m))
      );
      return;
    }

    const insertRow: Record<string, unknown> = {
      shop_id: shopId,
      phone_number: activePhone,
      role: "model",
      content: text,
    };
    if (replyId && replySnippet) {
      insertRow.reply_to_id = replyId;
      insertRow.reply_snippet = replySnippet;
    }

    const ins1 = await supabase
      .from("messages")
      .insert([insertRow])
      .select("id, created_at")
      .single();

    let data = ins1.data as Record<string, unknown> | null;
    let error = ins1.error;

    if (error && isMissingChatColumnsError(error) && (insertRow.reply_to_id || insertRow.reply_snippet)) {
      delete insertRow.reply_to_id;
      delete insertRow.reply_snippet;
      const ins2 = await supabase
        .from("messages")
        .insert([insertRow])
        .select("id, created_at")
        .single();
      data = ins2.data as Record<string, unknown> | null;
      error = ins2.error;
    }

    if (error || !data) {
      // Mark as error
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, status: "error" } : m))
      );
      return;
    }

    // 3. Promote the optimistic bubble to the real DB id/timestamp RIGHT NOW,
    //    before the WhatsApp delivery call. This guarantees tempId is always
    //    cleaned up regardless of whether delivery succeeds or fails, and the
    //    bubble sorts into the correct chronological position immediately.
    const realId = String((data as Record<string, unknown>).id ?? tempId);
    const realIso = String((data as Record<string, unknown>).created_at ?? isoNow);

    setMessages((prev) =>
      prev.map((m) =>
        m.id === tempId
          ? { ...m, id: realId, isoTime: realIso, time: fmtBubbleTime(realIso), status: "sending" }
          : m
      )
    );

    // Update sidebar now so it reflects the new message immediately
    setConversations((prev) => {
      const others = prev.filter((c) => c.phone !== activePhone);
      return [
        { phone: activePhone, lastMessage: text, isoTimestamp: realIso, unread: 0 },
        ...others,
      ];
    });

    // 4. Deliver to the customer's WhatsApp via the admin-send API route.
    //    We await so we can catch HTTP-level errors (500) — not just network failures.
    let waWamid: string | undefined;
    try {
      const waRes = await fetch("/api/admin-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone_number: activePhone,
          message: text,
          ...(shopId ? { shop_id: shopId } : {}),
        }),
      });

      if (!waRes.ok) {
        let errDetail: unknown = "(no body)";
        try { errDetail = await waRes.json(); } catch { /* not JSON */ }
        console.error(
          `[sendMessage] /api/admin-send returned ${waRes.status}:`,
          errDetail
        );
        // Mark the (now-real) bubble red so the admin knows WhatsApp delivery failed
        setMessages((prev) =>
          prev.map((m) => (m.id === realId ? { ...m, status: "error" } : m))
        );
        return;
      }

      try {
        // admin-send returns { ok: true, data: <Meta response> } where the Meta
        // response holds messages[0].id (the wamid). Handle both nested + flat shapes.
        const waData = (await waRes.json()) as {
          messages?: Array<{ id?: string }>;
          data?: { messages?: Array<{ id?: string }> };
        };
        const id = waData?.data?.messages?.[0]?.id ?? waData?.messages?.[0]?.id;
        if (typeof id === "string" && id.trim()) waWamid = id.trim();
      } catch {
        /* ignore parse errors */
      }

      if (waWamid) {
        const { error: waPersistErr } = await supabase
          .from("messages")
          .update({ wa_message_id: waWamid })
          .eq("id", realId)
          .eq("shop_id", shopId);
        if (waPersistErr) {
          console.warn("[sendMessage] wa_message_id persist failed:", waPersistErr.message);
        }
      }
    } catch (networkErr) {
      console.error("[sendMessage] /api/admin-send network error:", networkErr);
      setMessages((prev) =>
        prev.map((m) => (m.id === realId ? { ...m, status: "error" } : m))
      );
      return;
    }

    // 5. Mark delivered — flip to "sent" (blue double-tick)
    setMessages((prev) =>
      prev.map((m) =>
        m.id === realId
          ? { ...m, status: "sent", ...(waWamid ? { waMessageId: waWamid } : {}) }
          : m
      )
    );

    // 6. If bot is currently disabled, restart the 20-min auto-enable timer
    //    (each human reply resets the countdown)
    if (!botActive) {
      startBotAutoEnableTimer();
    }
  }, [inputText, activePhone, shopId, replyingTo, botActive, startBotAutoEnableTimer]);

  const sendImageMessage = useCallback(async (file: File) => {
    if (!activePhone || !shopId || !supabase) return;
    const mime = resolvePickerImageMime(file);
    if (!mime) {
      window.alert("Unsupported image format. Please use JPG, PNG, or WEBP.");
      return;
    }
    const defaultName =
      mime === "image/png" ? "image.png" : mime === "image/webp" ? "image.webp" : "image.jpg";
    const uploadFile = new File([file], file.name || defaultName, { type: mime });

    const tempId = `opt-img-${Date.now()}`;
    const previewUrl = URL.createObjectURL(uploadFile);
    const isoNow = new Date().toISOString();

    const optimisticMsg: Message = {
      id: tempId,
      sender: "ai",
      content: previewUrl,
      time: fmtBubbleTime(isoNow),
      isoTime: isoNow,
      status: "sending",
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setEmojiOpen(false);
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 30);

    try {
      const form = new FormData();
      form.append("phone_number", activePhone);
      form.append("shop_id", shopId);
      form.append("kind", "image");
      form.append("image", uploadFile);

      const sendRes = await fetch("/api/admin-send-media", {
        method: "POST",
        body: form,
      });

      if (!sendRes.ok) {
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, status: "error" } : m))
        );
        return;
      }

      const payload = (await sendRes.json()) as {
        media_id?: string;
        wa_message_id?: string;
      };
      const mediaId = typeof payload.media_id === "string" ? payload.media_id : "";
      const waWamid =
        typeof payload.wa_message_id === "string" && payload.wa_message_id.trim()
          ? payload.wa_message_id.trim()
          : undefined;
      if (!mediaId) {
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, status: "error" } : m))
        );
        return;
      }

      const { data, error } = await supabase
        .from("messages")
        .insert([
          {
            shop_id: shopId,
            phone_number: activePhone,
            role: "model",
            content: `wa-media:${mediaId}:image`,
          },
        ])
        .select("id, created_at")
        .single();

      if (error || !data) {
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, status: "error" } : m))
        );
        return;
      }

      const realId = String((data as Record<string, unknown>).id ?? tempId);
      const realIso = String((data as Record<string, unknown>).created_at ?? isoNow);

      if (waWamid) {
        const { error: waPersistErr } = await supabase
          .from("messages")
          .update({ wa_message_id: waWamid })
          .eq("id", realId)
          .eq("shop_id", shopId);
        if (waPersistErr) {
          console.warn("[sendImageMessage] wa_message_id persist failed:", waPersistErr.message);
        }
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempId
            ? {
                ...m,
                id: realId,
                isoTime: realIso,
                time: fmtBubbleTime(realIso),
                content: `wa-media:${mediaId}:image`,
                status: "sent",
                ...(waWamid ? { waMessageId: waWamid } : {}),
              }
            : m
        )
      );

      setConversations((prev) => {
        const others = prev.filter((c) => c.phone !== activePhone);
        return [
          { phone: activePhone, lastMessage: "Photo", isoTimestamp: realIso, unread: 0 },
          ...others,
        ];
      });
    } finally {
      URL.revokeObjectURL(previewUrl);
    }
  }, [activePhone, shopId]);

  const sendVoiceNote = useCallback(async (blob: Blob) => {
    if (!activePhone || !shopId || !supabase) return;
    const file = audioFileForWhatsApp(blob);
    if (!file) {
      window.alert("Unsupported audio format from this recording.");
      return;
    }

    const tempId = `opt-audio-${Date.now()}`;
    const isoNow = new Date().toISOString();
    const optimisticMsg: Message = {
      id: tempId,
      sender: "ai",
      content: URL.createObjectURL(file),
      time: fmtBubbleTime(isoNow),
      isoTime: isoNow,
      status: "sending",
    };
    setMessages((prev) => [...prev, optimisticMsg]);
    setEmojiOpen(false);
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 30);

    try {
      const form = new FormData();
      form.append("phone_number", activePhone);
      form.append("shop_id", shopId);
      form.append("kind", "audio");
      form.append("audio", file);

      const sendRes = await fetch("/api/admin-send-media", { method: "POST", body: form });
      if (!sendRes.ok) {
        try {
          const errJson = await sendRes.clone().json();
          const detail =
            errJson?.error ??
            errJson?.details?.error?.message ??
            JSON.stringify(errJson)?.slice(0, 280);
          if (detail) window.alert(typeof detail === "string" ? detail : String(detail));
        } catch {
          window.alert(`Voice upload failed (${sendRes.status}). Check server logs.`);
        }
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, status: "error" } : m)),
        );
        return;
      }

      const payload = (await sendRes.json()) as {
        media_id?: string;
        wa_message_id?: string;
      };
      const mediaId = typeof payload.media_id === "string" ? payload.media_id : "";
      const waWamid =
        typeof payload.wa_message_id === "string" && payload.wa_message_id.trim()
          ? payload.wa_message_id.trim()
          : undefined;
      if (!mediaId) {
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, status: "error" } : m)),
        );
        return;
      }

      const { data, error } = await supabase
        .from("messages")
        .insert([
          {
            shop_id: shopId,
            phone_number: activePhone,
            role: "model",
            content: `wa-media:${mediaId}:audio`,
          },
        ])
        .select("id, created_at")
        .single();

      if (error || !data) {
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, status: "error" } : m)),
        );
        return;
      }

      const realId = String((data as Record<string, unknown>).id ?? tempId);
      const realIso = String((data as Record<string, unknown>).created_at ?? isoNow);

      if (waWamid) {
        const { error: waPersistErr } = await supabase
          .from("messages")
          .update({ wa_message_id: waWamid })
          .eq("id", realId)
          .eq("shop_id", shopId);
        if (waPersistErr) {
          console.warn("[sendVoiceNote] wa_message_id persist failed:", waPersistErr.message);
        }
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempId
            ? {
                ...m,
                id: realId,
                isoTime: realIso,
                time: fmtBubbleTime(realIso),
                content: `wa-media:${mediaId}:audio`,
                status: "sent",
                ...(waWamid ? { waMessageId: waWamid } : {}),
              }
            : m,
        ),
      );

      setConversations((prev) => {
        const others = prev.filter((c) => c.phone !== activePhone);
        return [
          { phone: activePhone, lastMessage: "Voice note", isoTimestamp: realIso, unread: 0 },
          ...others,
        ];
      });
    } finally {
      URL.revokeObjectURL(optimisticMsg.content);
    }
  }, [activePhone, shopId]);

  // Voice recorder hook — drives the input-area waveform + the corner send button
  const voice = useVoiceRecorder(sendVoiceNote);

  const handleDeleteMessage = useCallback(
    async (msg: Message) => {
      if (!supabase || !shopId) return;
      if (String(msg.id).startsWith("opt-")) return;
      if (
        !window.confirm(
          "Delete this message? It will be removed from this chat for your team.",
        )
      ) {
        return;
      }
      // Record the id so polling/realtime won't re-add it before the DB delete propagates
      deletedIdsRef.current.add(String(msg.id));
      // Optimistically remove from UI immediately
      setMessages((prev) => prev.filter((m) => m.id !== msg.id));

      // Delete via server route (service role) to bypass RLS restrictions
      try {
        const res = await fetch("/api/admin-delete-message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: msg.id, shop_id: shopId }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          deletedIdsRef.current.delete(String(msg.id));
          window.alert(`Could not delete message: ${data.error || res.status}`);
        }
      } catch (e) {
        deletedIdsRef.current.delete(String(msg.id));
        window.alert(`Network error deleting message: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [shopId],
  );

  const commitEditMessage = useCallback(async () => {
    if (!shopId || !editingMessage) return;
    const next = editDraft.trim();
    if (!next) return;

    // NOTE: We only edit the message in our dashboard inbox. The Meta Cloud API
    // does NOT support editing an already-sent message. Update via server route
    // (service role) to bypass RLS restrictions.
    try {
      const res = await fetch("/api/admin-update-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingMessage.id, shop_id: shopId, content: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        window.alert(`Could not edit message: ${data.error || res.status}`);
        return;
      }
      const data = await res.json().catch(() => ({}));
      const editedAt = data.edited_at ?? new Date().toISOString();
      setMessages((prev) =>
        prev.map((m) =>
          m.id === editingMessage.id ? { ...m, content: next, editedAt } : m,
        ),
      );
      setEditingMessage(null);
      setEditDraft("");
    } catch (e) {
      window.alert(`Network error editing message: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [shopId, editingMessage, editDraft]);

  // ─────────────────────────────────────────────────────────────────────────
  // Input handlers
  // ─────────────────────────────────────────────────────────────────────────

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const insertEmoji = (emoji: string) => {
    const el = textareaRef.current;
    const current = inputText;
    if (!el) {
      setInputText((prev) => prev + emoji);
      return;
    }
    const start = el.selectionStart ?? current.length;
    const end = el.selectionEnd ?? current.length;
    const next = `${current.slice(0, start)}${emoji}${current.slice(end)}`;
    setInputText(next);
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + emoji.length;
      el.selectionStart = cursor;
      el.selectionEnd = cursor;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
    });
  };

  const quickEmojis = ["😀", "😂", "😍", "👍", "🙏", "🎉", "🔥", "❤️", "✅", "🙌"];

  // ─────────────────────────────────────────────────────────────────────────
  // Derived
  // ─────────────────────────────────────────────────────────────────────────

  const filteredConvs = conversations.filter((c) => {
    const q = searchQuery.toLowerCase();
    const label = (savedContacts[c.phone] ?? c.phone).toLowerCase();
    return (
      label.includes(q) ||
      c.phone.toLowerCase().includes(q) ||
      c.lastMessage.toLowerCase().includes(q)
    );
  });

  const activeConv = conversations.find((c) => c.phone === activePhone) ?? null;
  const activeDisplayName =
    activeConv && shopId
      ? savedContacts[activeConv.phone] ?? activeConv.phone
      : activeConv?.phone ?? "";

  const messageMenuTarget =
    messageMenu == null ? null : (messages.find((m) => m.id === messageMenu.id) ?? null);

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto flex h-full w-full max-w-full flex-1 flex-row overflow-hidden rounded-none border-0 shadow-none md:rounded-2xl md:border md:border-[var(--color-border-card)] md:shadow-[var(--shadow-card)]">

      {/* ── Conversation List ────────────────────────────────────────────── */}
      <div
        data-chat-panel
        className={[
          "flex h-full flex-col bg-[var(--color-surface-solid)] md:border-r md:border-[var(--color-border)] md:flex-none",
          isMobileChatOpen ? "hidden md:flex" : "flex",
        ].join(" ")}
        style={{ "--panel-w": `${panelWidth}%` } as React.CSSProperties}
      >
        {/* Header */}
        <div className="px-5 py-3 md:py-4 flex items-center justify-between shrink-0 md:border-b md:border-[var(--color-border)]">
          <div>
            <h1 className="font-bold text-[28px] md:text-[17px] text-[var(--color-text-primary)] tracking-tight">Chats</h1>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setNewChatOpen(true)}
              title="New Chat"
              className="p-2 rounded-xl hover:bg-[var(--color-surface-secondary)] text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)] transition-colors"
            >
              <UserPlus className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => void fetchConversations()}
              title="Refresh"
              className="p-2 rounded-xl hover:bg-[var(--color-surface-secondary)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              <RefreshCw className={["w-4 h-4", convsLoading ? "animate-spin" : ""].join(" ")} />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-4 py-2 md:py-3 md:border-b md:border-[var(--color-border)] shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 md:w-3.5 md:h-3.5 text-[var(--color-text-tertiary)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search conversations…"
              className="w-full bg-[var(--color-surface-secondary)] rounded-xl pl-10 md:pl-9 pr-4 py-2.5 md:py-2 text-[16px] md:text-[13px] border border-transparent focus:border-[var(--color-accent)] focus:ring-0 transition-colors"
            />
          </div>
        </div>

        {/* List */}
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          {convsLoading ? (
            <div className="py-8 flex flex-col gap-3 px-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex gap-3 items-center animate-pulse">
                  <div className="w-11 h-11 rounded-full bg-[var(--color-surface-secondary)] flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-[var(--color-surface-secondary)] rounded-lg w-3/4" />
                    <div className="h-3 bg-[var(--color-surface-secondary)] rounded-lg w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredConvs.length === 0 ? (
            <div className="py-16 text-center text-[var(--color-text-tertiary)] text-sm">
              No conversations found
            </div>
          ) : (
            filteredConvs.map((conv) => (
              <ConversationRow
                key={conv.phone}
                conv={conv}
                displayLabel={savedContacts[conv.phone] ?? conv.phone}
                isActive={activePhone === conv.phone}
                onClick={() => openConversation(conv.phone)}
              />
            ))
          )}
        </div>
      </div>

      {/* ── Resize Handle (desktop only) ─────────────────────────────────── */}
      <div
        className="hidden md:flex w-1 cursor-col-resize items-center justify-center hover:bg-[var(--color-accent)]/20 active:bg-[var(--color-accent)]/30 transition-colors group"
        onMouseDown={(e) => {
          e.preventDefault();
          isResizingRef.current = true;
          const container = (e.currentTarget.parentElement as HTMLElement);
          const startX = e.clientX;
          const startWidth = panelWidth;

          const onMouseMove = (ev: MouseEvent) => {
            if (!isResizingRef.current) return;
            const containerWidth = container.getBoundingClientRect().width;
            const delta = ev.clientX - startX;
            const newPercent = startWidth + (delta / containerWidth) * 100;
            setPanelWidth(Math.min(50, Math.max(15, newPercent)));
          };

          const onMouseUp = () => {
            isResizingRef.current = false;
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
          };

          document.addEventListener("mousemove", onMouseMove);
          document.addEventListener("mouseup", onMouseUp);
          document.body.style.cursor = "col-resize";
          document.body.style.userSelect = "none";
        }}
      >
        <div className="w-[3px] h-8 rounded-full bg-[var(--color-border)] group-hover:bg-[var(--color-accent)] transition-colors" />
      </div>

      {/* ── Chat Window ──────────────────────────────────────────────────── */}
      <div
        className={[
          "flex h-full flex-col overflow-hidden md:flex",
          isMobileChatOpen ? "flex w-full" : "hidden md:flex md:flex-1",
        ].join(" ")}
        style={{
          backgroundColor: "var(--wa-chat-bg)",
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='0.03'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}
      >
        {activeConv ? (
          <>
            {/* Chat header */}
            <div className="flex h-[60px] min-w-0 shrink-0 items-center gap-2 overflow-x-hidden border-b border-[var(--color-border)] bg-[var(--color-surface-solid)] px-3 pt-[env(safe-area-inset-top)] shadow-[var(--shadow-sm)] sm:gap-3 sm:px-4 md:pt-0">
              <button
                type="button"
                onClick={() => setIsMobileChatOpen(false)}
                className="md:hidden p-1.5 -ml-1 rounded-xl hover:bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] transition-colors"
                aria-label="Back to conversations"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>

              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-dark)] flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                {phoneInitials(activeConv.phone)}
              </div>

              <div className="flex-1 min-w-0">
                <p className="font-semibold text-[15px] text-[var(--color-text-primary)] truncate leading-tight">
                  {activeDisplayName}
                </p>
                <p className="text-[11px] text-[var(--color-text-tertiary)] truncate">
                  {savedContacts[activeConv.phone] ? activeConv.phone : "WhatsApp · Business inbox"}
                </p>
              </div>

              {/* Bot toggle switch */}
              <div className="flex shrink-0 items-center gap-1.5 mr-1">
                <Bot className={["w-4 h-4 transition-colors", botActive ? "text-green-500" : "text-[var(--color-text-tertiary)]"].join(" ")} />
                <button
                  type="button"
                  role="switch"
                  aria-checked={botActive}
                  aria-label={botActive ? "Bot is active — click to disable" : "Bot is paused — click to enable"}
                  title={botActive ? "Bot ON — auto-replies enabled" : "Bot OFF — auto-replies paused (re-enables in 20 min)"}
                  disabled={botToggleLoading}
                  onClick={() => void toggleBotActive(!botActive)}
                  className={[
                    "relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:ring-offset-1",
                    botActive ? "bg-green-500" : "bg-gray-300",
                    botToggleLoading ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform duration-200",
                      botActive ? "translate-x-[18px]" : "translate-x-[3px]",
                    ].join(" ")}
                  />
                </button>
                <span className="hidden sm:inline text-[10px] font-medium text-[var(--color-text-tertiary)] whitespace-nowrap">
                  {botActive ? "Bot ON" : "Bot OFF"}
                </span>
              </div>

              <div className="flex shrink-0 items-center gap-0.5 sm:gap-0.5">
                <button
                  type="button"
                  onClick={() => {
                    if (!activeConv?.phone || !shopId) return;
                    setContactDraft(savedContacts[activeConv.phone] ?? "");
                    setSaveContactOpen(true);
                  }}
                  title="Save contact name"
                  className="rounded-full p-2 text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-secondary)] hover:text-[var(--color-text-primary)]"
                  aria-label="Save contact"
                >
                  <UserPlus className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!activeConv?.phone) return;
                    const digits = activeConv.phone.replace(/\D/g, "");
                    if (!digits) return;
                    window.open(
                      `https://wa.me/${digits}`,
                      "_blank",
                      "noopener,noreferrer",
                    );
                  }}
                  title="Open in WhatsApp"
                  className="rounded-full p-2 text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-secondary)] hover:text-[var(--color-text-primary)]"
                  aria-label="Open in WhatsApp"
                >
                  <Phone className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="hidden rounded-full p-2 text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-secondary)] hover:text-[var(--color-text-primary)] sm:inline-flex"
                  aria-label="Video (placeholder)"
                >
                  <Video className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="hidden rounded-full p-2 text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-secondary)] hover:text-[var(--color-text-primary)] sm:inline-flex"
                  aria-label="More"
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* "Load older" banner, visible when older messages exist */}
            {hasOlderMessages && (
              <div className="shrink-0 flex justify-center py-2 bg-transparent">
                {loadingOlder ? (
                  <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-tertiary)] bg-[var(--color-surface-secondary)] rounded-full px-3 py-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Loading older messages…
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={fetchOlderMessages}
                    className="text-[11px] text-[var(--color-accent)] bg-[var(--color-accent-light)] rounded-full px-3 py-1 hover:opacity-80 transition-opacity"
                  >
                    ↑ Load older messages
                  </button>
                )}
              </div>
            )}

            {/* Messages container */}
            <div
              ref={messagesContainerRef}
              className="flex-1 space-y-1 overflow-x-hidden overflow-y-auto overscroll-y-contain px-2 py-3 sm:px-4"
            >
              {msgsLoading ? (
                <div className="flex flex-col gap-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className={["flex animate-pulse", i % 2 === 0 ? "justify-start" : "justify-end"].join(" ")}>
                      <div className={["h-10 rounded-2xl bg-[var(--color-surface-secondary)]", i % 2 === 0 ? "w-48" : "w-56"].join(" ")} />
                    </div>
                  ))}
                </div>
              ) : messages.length === 0 ? (
                <div className="flex items-center justify-center h-full text-[var(--color-text-tertiary)] text-sm">
                  No messages yet. Say hello!
                </div>
              ) : (
                // Sort ascending by ISO timestamp so oldest bubbles sit at the
                // top and the newest (including optimistic messages) sit at the
                // bottom — regardless of the order items were pushed into state.
                sortMessagesChronologically(messages).map((msg) => (
                    <ChatBubble
                      key={msg.id}
                      msg={msg}
                      onOpenMessageMenu={(rect) =>
                        openMessageMenu(msg.id, rect, msg.sender === "ai")
                      }
                    />
                  ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {messageMenu && messageMenuTarget ? (
              <MessageMenuLayer
                key={messageMenu.id}
                message={messageMenuTarget}
                anchor={messageMenu.anchor}
                isAI={messageMenu.isAI}
                onClose={closeMessageMenu}
                onReply={(m) => {
                  closeMessageMenu();
                  setReplyingTo(m);
                }}
                onEdit={(m) => {
                  closeMessageMenu();
                  setEditingMessage(m);
                  setEditDraft(m.content);
                }}
                onDelete={(m) => {
                  closeMessageMenu();
                  void handleDeleteMessage(m);
                }}
              />
            ) : null}

            {/* Input area */}
            <div className="shrink-0 flex flex-col bg-[var(--color-surface-solid)] border-t border-[var(--color-border)] pb-[max(12px,env(safe-area-inset-bottom))]">
              {/* 24h window closed banner */}
              {isPast24Hours && (
                <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-200/60 bg-amber-50/80">
                  <Clock className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
                  <p className="text-[11px] text-amber-700">
                    24-hour messaging window closed. Use a template message to re-engage this customer.
                  </p>
                </div>
              )}
              {replyingTo ? (
                <div className="flex items-stretch gap-2 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--wa-reply-bar)]">
                  <div className="min-w-0 flex-1 border-l-[3px] border-[#008069] pl-2">
                    <div className="text-[10px] font-semibold text-[#008069] uppercase tracking-wide">
                      Replying to
                    </div>
                    <div className="text-[12px] text-[var(--color-text-secondary)] truncate">
                      {messageSnippetForReply(replyingTo)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReplyingTo(null)}
                    className="self-center p-1.5 rounded-full hover:bg-[var(--color-surface-secondary)] text-[var(--color-text-tertiary)]"
                    aria-label="Cancel reply"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : null}
              <div className="flex min-w-0 items-end gap-1.5 px-3 py-2.5">
              {!voice.isActive && (
              <button type="button" onClick={() => setEmojiOpen((v) => !v)} className={["p-2 rounded-xl hover:bg-[var(--color-surface-secondary)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors flex-shrink-0 mb-0.5", isPast24Hours ? "opacity-50 cursor-not-allowed" : ""].join(" ")} aria-label="Emoji" disabled={isPast24Hours}>
                <Smile className="w-5 h-5" />
              </button>
              )}

              {/* Template + button (always visible, primary action when 24h window closed) */}
              {!voice.isActive && (
              <div ref={templateContainerRef} className="relative flex-shrink-0 mb-0.5">
                <button
                  type="button"
                  onClick={() => setTemplateMenuOpen((v) => !v)}
                  className={[
                    "p-2 rounded-xl transition-colors",
                    isPast24Hours
                      ? "bg-amber-100 text-amber-700 hover:bg-amber-200 ring-1 ring-amber-300"
                      : "hover:bg-[var(--color-surface-secondary)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]",
                  ].join(" ")}
                  aria-label="Template messages"
                  title={isPast24Hours ? "Send a template message (24h window closed)" : "Send a template message"}
                >
                  <Plus className="w-5 h-5" />
                </button>

                {/* Template popover menu */}
                {templateMenuOpen && (
                  <div className="absolute bottom-[calc(100%+0.5rem)] left-0 z-30 w-48 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-solid)] p-1.5 shadow-lg">
                    <button
                      type="button"
                      onClick={() => {
                        setTemplateMenuOpen(false);
                        setTemplateModalOpen(true);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-secondary)] transition-colors"
                    >
                      <FileText className="w-4 h-4 text-[var(--color-accent)]" />
                      Send Template
                    </button>
                    <button
                      type="button"
                      disabled={sendingReviews}
                      onClick={async () => {
                        setTemplateMenuOpen(false);
                        if (!supabase || !shopId || !activePhone) {
                          window.alert("Cannot send reviews: no active conversation or shop selected.");
                          return;
                        }
                        setSendingReviews(true);
                        try {
                          // Fetch reviews for this shop
                          const { data: reviews, error: revErr } = await supabase
                            .from("reviews")
                            .select("image_url")
                            .eq("shop_id", shopId)
                            .order("sort_order", { ascending: true });

                          if (revErr) {
                            window.alert(`Error loading reviews: ${revErr.message}`);
                            return;
                          }

                          const { data: bizRow } = await supabase
                            .from("businesses")
                            .select("reviews_link")
                            .eq("id", shopId)
                            .maybeSingle();

                          const reviewsList = (reviews ?? []) as { image_url: string }[];
                          const reviewsLink = (bizRow as { reviews_link?: string | null })?.reviews_link ?? "";

                          if (reviewsList.length === 0 && !reviewsLink) {
                            window.alert("No reviews configured. Go to Products → ⭐ Reviews to add review screenshots or a link.");
                            return;
                          }

                          // Send each review image via the image URL endpoint
                          let sentCount = 0;
                          for (const review of reviewsList) {
                            const res = await fetch("/api/admin-send-image-url", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                phone_number: activePhone,
                                image_url: review.image_url,
                                caption: "",
                                shop_id: shopId,
                              }),
                            });
                            if (res.ok) sentCount++;
                          }

                          // Send the reviews link as a text message if it exists
                          if (reviewsLink) {
                            const res = await fetch("/api/admin-send", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                phone_number: activePhone,
                                message: `⭐ Check out our customer reviews: ${reviewsLink}`,
                                shop_id: shopId,
                              }),
                            });
                            if (res.ok) sentCount++;
                          }

                          if (sentCount > 0) {
                            window.alert(`✅ Reviews sent successfully! (${sentCount} message${sentCount > 1 ? "s" : ""})`);
                          } else {
                            window.alert("Failed to send reviews. Check your Meta API configuration.");
                          }
                        } catch (err) {
                          console.error("[Send reviews error]", err);
                          window.alert("Failed to send reviews.");
                        } finally {
                          setSendingReviews(false);
                        }
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-secondary)] transition-colors"
                    >
                      <Star className="w-4 h-4 text-amber-500" />
                      {sendingReviews ? "Sending..." : "Send Reviews"}
                    </button>
                    {!isPast24Hours && (
                      <button
                        type="button"
                        onClick={() => {
                          setTemplateMenuOpen(false);
                          imageInputRef.current?.click();
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-secondary)] transition-colors"
                      >
                        <ImageOff className="w-4 h-4 text-[var(--color-text-tertiary)]" />
                        Send Image
                      </button>
                    )}
                  </div>
                )}
              </div>
              )}

              {/* Mic button — only when not recording */}
              {!voice.isActive && (
                <button
                  type="button"
                  onClick={() => void voice.startRecording()}
                  disabled={isPast24Hours}
                  className={[
                    "p-2 rounded-xl transition-colors flex-shrink-0 mb-0.5",
                    isPast24Hours
                      ? "opacity-50 cursor-not-allowed text-[var(--color-text-tertiary)]"
                      : "hover:bg-[var(--color-surface-secondary)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]",
                  ].join(" ")}
                  aria-label="Record voice note"
                  title="Record voice note"
                >
                  <Mic className="w-5 h-5" />
                </button>
              )}
              <input
                ref={imageInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void sendImageMessage(file);
                  e.currentTarget.value = "";
                }}
              />

              {voice.isActive ? (
                /* Voice recording/preview bar — replaces text field. WhatsApp style. */
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <button
                    type="button"
                    onClick={voice.discardRecording}
                    className="flex-shrink-0 p-2 rounded-full text-[#8696a0] hover:text-[#ef4444] transition-colors"
                    aria-label="Delete recording"
                    title="Delete"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                  <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-full bg-[var(--color-surface-secondary)] px-4 py-3">
                    <div className="w-2.5 h-2.5 flex-shrink-0 rounded-full bg-[#ef4444] animate-pulse" />
                    <span className="text-sm font-mono text-[var(--color-text-primary)] flex-shrink-0 tabular-nums">
                      {formatVoiceTime(voice.duration)}
                    </span>
                    <div className="flex flex-1 items-center gap-[2px] h-6 overflow-hidden justify-end">
                      {(voice.levels.length > 0 ? voice.levels : [0.1]).map((lvl, i) => (
                        <div
                          key={i}
                          className="w-[3px] rounded-full bg-[#25d366] flex-shrink-0"
                          style={{ height: `${Math.max(3, lvl * 24)}px` }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className={["relative flex min-w-0 flex-1 items-end overflow-visible rounded-2xl border transition-all", isPast24Hours ? "border-gray-300 bg-gray-200 opacity-50 cursor-not-allowed" : "border-[var(--color-border)] bg-[var(--color-surface-secondary)] focus-within:border-[var(--color-accent)] focus-within:shadow-[0_0_0_3px_var(--color-accent-glow)]"].join(" ")}>
                  {emojiOpen && !isPast24Hours ? (
                    <div className="absolute bottom-[calc(100%+0.5rem)] left-0 z-20 grid grid-cols-5 gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-solid)] p-2 shadow-lg">
                      {quickEmojis.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => insertEmoji(emoji)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-base hover:bg-[var(--color-surface-secondary)]"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <textarea
                    ref={textareaRef}
                    id="chat-input"
                    value={inputText}
                    onChange={handleInput}
                    onKeyDown={handleKeyDown}
                    placeholder={isPast24Hours ? "24h window closed. Use a template to reply." : "Type a message…"}
                    rows={1}
                    disabled={isPast24Hours}
                    className={["max-h-32 w-full min-w-0 resize-none border-none bg-transparent px-4 py-3 text-[16px] md:text-[13.5px] leading-relaxed outline-none focus:border-transparent focus:shadow-none focus:ring-0", isPast24Hours ? "cursor-not-allowed placeholder:text-amber-600/70" : ""].join(" ")}
                    style={{ boxShadow: "none" }}
                  />
                </div>
              )}

              <button
                type="button"
                id="chat-send-button"
                onClick={voice.isActive ? voice.sendRecording : sendMessage}
                disabled={
                  !voice.isActive && (!inputText.trim() || !shopId || !activePhone || isPast24Hours)
                }
                title={
                  voice.isActive
                    ? "Send voice note"
                    : isPast24Hours
                      ? "24h window closed — use a template message"
                      : !shopId
                        ? "No shop selected — sign in again or pick a store"
                        : !activePhone
                          ? "Select a conversation"
                          : undefined
                }
                aria-label="Send message"
                className={[
                  "flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center mb-0.5 transition-all duration-200",
                  voice.isActive
                    ? "bg-[#25d366] text-white shadow-md hover:bg-[#20bd5a] hover:scale-105"
                    : inputText.trim() && shopId && activePhone && !isPast24Hours
                      ? "bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-dark)] text-white shadow-[var(--shadow-glow-indigo)] hover:shadow-lg hover:scale-105"
                      : "bg-[var(--color-surface-secondary)] text-[var(--color-text-tertiary)] cursor-not-allowed",
                ].join(" ")}
              >
                <Send className="w-4 h-4 -translate-x-px translate-y-px" />
              </button>
              </div>
            </div>

            {/* Template Modal */}
            {templateModalOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]">
                <div className="w-full max-w-md rounded-2xl border border-[var(--color-border-card)] bg-[var(--color-surface-solid)] p-5 shadow-2xl">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-[16px] font-semibold text-[var(--color-text-primary)]">
                      Send Template Message
                    </h3>
                    <button
                      type="button"
                      onClick={() => {
                        setTemplateModalOpen(false);
                        setSelectedTemplate("");
                      }}
                      className="p-1.5 rounded-full hover:bg-[var(--color-surface-secondary)] text-[var(--color-text-tertiary)]"
                      aria-label="Close"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-[12px] text-[var(--color-text-tertiary)] mb-4">
                    Select an approved template to send to this customer. This will re-open the 24-hour messaging window once they reply.
                  </p>

                  <label className="block text-[12px] font-medium text-[var(--color-text-secondary)] mb-1.5">
                    Template
                  </label>
                  <select
                    value={selectedTemplate}
                    onChange={(e) => setSelectedTemplate(e.target.value)}
                    className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-3 py-2.5 text-[14px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)] appearance-none"
                  >
                    <option value="">Choose a template…</option>
                    {(metaTemplates.length > 0 ? metaTemplates : FALLBACK_TEMPLATES).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>

                  {selectedTemplate && (
                    <div className="mt-3 rounded-xl bg-[var(--color-surface-secondary)] border border-[var(--color-border)] px-3 py-2">
                      <p className="text-[12px] text-[var(--color-text-secondary)]">
                        {(metaTemplates.length > 0 ? metaTemplates : FALLBACK_TEMPLATES).find((t) => t.id === selectedTemplate)?.description}
                      </p>
                    </div>
                  )}

                  <div className="mt-5 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setTemplateModalOpen(false);
                        setSelectedTemplate("");
                      }}
                      className="rounded-xl px-4 py-2 text-[13px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={!selectedTemplate || sendingTemplate}
                      onClick={async () => {
                        if (!selectedTemplate || !activePhone || !shopId) return;
                        setSendingTemplate(true);
                        const template = (metaTemplates.length > 0 ? metaTemplates : FALLBACK_TEMPLATES).find((t) => t.id === selectedTemplate);
                        try {
                          const res = await fetch("/api/admin-send-template", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              phone_number: activePhone,
                              template_name: selectedTemplate,
                              language: template?.language || "en",
                              shop_id: shopId,
                            }),
                          });
                          const data = await res.json();
                          if (!res.ok) {
                            const detail = data?.details?.error?.message || data?.error || "Failed to send template";
                            window.alert(`Error: ${detail}`);
                          } else {
                            // Template sent successfully — unlock the input so admin can send follow-up messages
                            templateSentAtRef.current = Date.now();
                            setIsPast24Hours(false);
                          }
                        } catch (err) {
                          console.error("[Template send error]", err);
                          window.alert("Network error: could not send template message.");
                        } finally {
                          setSendingTemplate(false);
                          setTemplateModalOpen(false);
                          setSelectedTemplate("");
                        }
                      }}
                      className={[
                        "rounded-xl px-4 py-2 text-[13px] font-semibold text-white transition-opacity",
                        !selectedTemplate || sendingTemplate ? "bg-gray-400 cursor-not-allowed" : "bg-[#008069] hover:opacity-90",
                      ].join(" ")}
                    >
                      {sendingTemplate ? (
                        <span className="flex items-center gap-1.5">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Sending…
                        </span>
                      ) : (
                        "Send Template"
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {editingMessage ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]">
                <div className="w-full max-w-md rounded-2xl border border-[var(--color-border-card)] bg-[var(--color-surface-solid)] p-5 shadow-2xl">
                  <h3 className="text-[16px] font-semibold text-[var(--color-text-primary)]">
                    Edit message
                  </h3>
                  <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
                    Updates the message in your inbox. WhatsApp on the customer phone is unchanged.
                  </p>
                  <textarea
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    rows={4}
                    className="mt-3 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-3 py-2 text-[14px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                  />
                  <div className="mt-4 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingMessage(null);
                        setEditDraft("");
                      }}
                      className="rounded-xl px-4 py-2 text-[13px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void commitEditMessage()}
                      className="rounded-xl bg-[#008069] px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90"
                    >
                      Save
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {saveContactOpen && activeConv && shopId ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]">
                <div className="w-full max-w-sm rounded-2xl border border-[var(--color-border-card)] bg-[var(--color-surface-solid)] p-5 shadow-2xl">
                  <h3 className="text-[16px] font-semibold text-[var(--color-text-primary)]">
                    Save contact
                  </h3>
                  <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)] break-all">
                    {activeConv.phone}
                  </p>
                  <label className="mt-3 block text-[12px] font-medium text-[var(--color-text-secondary)]">
                    Name
                    <input
                      value={contactDraft}
                      onChange={(e) => setContactDraft(e.target.value)}
                      placeholder="e.g. John — Cake orders"
                      className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-3 py-2 text-[14px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                    />
                  </label>
                  <div className="mt-4 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setSaveContactOpen(false)}
                      className="rounded-xl px-4 py-2 text-[13px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const next = persistContactName(shopId, activeConv.phone, contactDraft);
                        setSavedContacts(next);
                        setSaveContactOpen(false);
                      }}
                      className="rounded-xl bg-[#008069] px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90"
                    >
                      Save
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          /* Empty state */
          <div className="flex-1 flex flex-col items-center justify-center text-center px-8 select-none">
            <div className="w-20 h-20 rounded-3xl bg-[var(--color-accent-light)] flex items-center justify-center mb-5 shadow-[var(--shadow-glow-indigo)]">
              <svg viewBox="0 0 24 24" fill="none" className="w-10 h-10 text-[var(--color-accent)]">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                <circle cx="9" cy="11" r="1" fill="currentColor" />
                <circle cx="12" cy="11" r="1" fill="currentColor" />
                <circle cx="15" cy="11" r="1" fill="currentColor" />
              </svg>
            </div>
            <h2 className="text-[17px] font-semibold text-[var(--color-text-primary)] mb-2">
              No conversation selected
            </h2>
            <p className="text-[13px] text-[var(--color-text-tertiary)] max-w-[260px] leading-relaxed">
              Pick a conversation from the list to start messaging your customers.
            </p>
          </div>
        )}
      </div>

      {/* New Chat Modal */}
      {newChatOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-sm rounded-2xl border border-[var(--color-border-card)] bg-[var(--color-surface-solid)] p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-[16px] font-semibold text-[var(--color-text-primary)]">
                New Conversation
              </h3>
              <button
                type="button"
                onClick={() => { setNewChatOpen(false); setNewChatPhone(""); }}
                className="p-1.5 rounded-full hover:bg-[var(--color-surface-secondary)] text-[var(--color-text-tertiary)]"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[12px] text-[var(--color-text-tertiary)] mb-4">
              Enter a phone number, or paste a WhatsApp link (wa.me/number).
            </p>
            <label className="block text-[12px] font-medium text-[var(--color-text-secondary)] mb-1.5">
              Phone Number or WhatsApp Link
            </label>
            <input
              type="text"
              value={newChatPhone}
              onChange={(e) => setNewChatPhone(e.target.value)}
              placeholder="94771234567 or https://wa.me/94771234567"
              className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-3 py-2.5 text-[14px] font-mono outline-none focus:border-[var(--color-accent)]"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const phone = extractPhoneFromInput(newChatPhone);
                  if (phone && phone.length >= 7) {
                    setNewChatOpen(false);
                    setNewChatPhone("");
                    openConversation(phone);
                  }
                }
              }}
            />
            <p className="mt-1.5 text-[11px] text-[var(--color-text-tertiary)]">
              Supports: 94771234567, +94 77 123 4567, wa.me/94771234567, api.whatsapp.com/send?phone=94771234567
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setNewChatOpen(false); setNewChatPhone(""); }}
                className="rounded-xl px-4 py-2 text-[13px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const phone = extractPhoneFromInput(newChatPhone);
                  if (phone && phone.length >= 7) {
                    setNewChatOpen(false);
                    setNewChatPhone("");
                    openConversation(phone);
                  }
                }}
                disabled={!extractPhoneFromInput(newChatPhone) || (extractPhoneFromInput(newChatPhone)?.length ?? 0) < 7}
                className="rounded-xl bg-[var(--color-accent)] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
              >
                Start Chat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ChatInterface;
