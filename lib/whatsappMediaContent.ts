/**
 * Parse how inbound WhatsApp media is stored in `messages.content`.
 *
 * Recommended for your webhook / bot: save
 *   wa-media:<META_MEDIA_ID>
 * or with a hint:
 *   wa-media:<ID>:audio   (voice notes)
 *   wa-media:<ID>:image
 *
 * Also accepts legacy patterns: image:/audio:/voice:/sticker: <id>
 * JSON: { "wa_media_id": "...", "type": "image" | "audio" }
 * Or a direct Meta CDN URL (see allowlisted hosts) — proxied via /api/whatsapp-media.
 */

export type WaMediaKindHint = "image" | "audio" | "document" | "video";

export type ParsedWhatsAppMedia =
  | { kind: "none" }
  | {
      kind: "media_id";
      mediaId: string;
      hint?: WaMediaKindHint;
      /** Text lines before a `wa-media:…` line (e.g. image caption). */
      caption?: string;
    }
  | { kind: "forward_url"; url: string; hint?: WaMediaKindHint }
  /** External bot saved a speech-to-text guess instead of `wa-media:<id>:audio`. */
  | { kind: "bot_transcription"; transcript: string };

/** Bot saved `[Voice Note]: …` text — not playable audio (no Meta media id). */
const BOT_VOICE_TRANSCRIPTION =
  /^\[(?:voice\s*note|voice\s*message|audio\s*message|audio|ptt)]\s*:\s*([\s\S]*)$/i;

export function parseBotVoiceTranscription(raw: string): string | null {
  const m = raw.trim().match(BOT_VOICE_TRANSCRIPTION);
  if (!m) return null;
  return m[1].trim();
}

const WA_MEDIA_LINE =
  /^wa-media:([A-Za-z0-9_-]+)(?::(image|audio|voice|sticker|document|video))?$/i;
const LEGACY_KIND_LINE =
  /^(image|audio|voice|sticker):\s*([A-Za-z0-9_-]+)\s*$/i;

/** Extract Meta media id from WhatsApp Cloud API attachment objects (audio, image, …). */
export function mediaIdFromWhatsAppAttachment(att: unknown): string | null {
  if (!att || typeof att !== "object") return null;
  const o = att as Record<string, unknown>;
  const raw = o.id ?? o.media_id;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return null;
}

export function isAllowlistedMetaMediaHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === "lookaside.fbsbx.com" ||
    h.endsWith(".fbcdn.net") ||
    h === "pps.whatsapp.net" ||
    /^mmg\.[^.]+\.whatsapp\.net$/i.test(h)
  );
}

export function parseWhatsAppMediaContent(raw: string): ParsedWhatsAppMedia {
  const t = raw.trim();

  // Prefer real media if bot stored both transcript + wa-media on separate lines
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const waLine = line.match(WA_MEDIA_LINE);
    if (waLine) {
      const tag = waLine[2]?.toLowerCase();
      let hint: WaMediaKindHint | undefined;
      if (tag === "voice" || tag === "audio") hint = "audio";
      else if (tag === "image" || tag === "sticker") hint = "image";
      else if (tag === "document") hint = "document";
      else if (tag === "video") hint = "video";
      const caption = lines.slice(0, i).join("\n").trim();
      return {
        kind: "media_id",
        mediaId: waLine[1],
        hint,
        caption: caption || undefined,
      };
    }
    const legLine = line.match(LEGACY_KIND_LINE);
    if (legLine) {
      const k = legLine[1].toLowerCase();
      const hint: WaMediaKindHint =
        k === "voice" || k === "audio" ? "audio" : "image";
      const caption = lines.slice(0, i).join("\n").trim();
      return {
        kind: "media_id",
        mediaId: legLine[2],
        hint,
        caption: caption || undefined,
      };
    }
  }

  const botTranscript = parseBotVoiceTranscription(raw);
  if (botTranscript !== null) {
    return { kind: "bot_transcription", transcript: botTranscript };
  }

  const wa = t.match(WA_MEDIA_LINE);
  if (wa) {
    const tag = wa[2]?.toLowerCase();
    let hint: WaMediaKindHint | undefined;
    if (tag === "voice" || tag === "audio") hint = "audio";
    else if (tag === "image" || tag === "sticker") hint = "image";
    else if (tag === "document") hint = "document";
    else if (tag === "video") hint = "video";
    return { kind: "media_id", mediaId: wa[1], hint };
  }

  const leg = t.match(LEGACY_KIND_LINE);
  if (leg) {
    const k = leg[1].toLowerCase();
    const hint: WaMediaKindHint =
      k === "voice" || k === "audio" ? "audio" : "image";
    return { kind: "media_id", mediaId: leg[2], hint };
  }

  if (t.startsWith("{")) {
    try {
      const j = JSON.parse(t) as Record<string, unknown>;
      const id =
        (typeof j.wa_media_id === "string" && j.wa_media_id) ||
        (typeof j.media_id === "string" && j.media_id) ||
        null;
      if (id) {
        const typ = String(j.type ?? j.kind ?? j.mime_type ?? "").toLowerCase();
        let hint: WaMediaKindHint | undefined;
        if (
          typ.includes("audio") ||
          typ.includes("voice") ||
          typ.includes("ogg") ||
          typ.includes("mpeg")
        ) {
          hint = "audio";
        } else if (
          typ.includes("image") ||
          typ.includes("sticker") ||
          typ.includes("jpeg") ||
          typ.includes("png") ||
          typ.includes("webp")
        ) {
          hint = "image";
        }
        return { kind: "media_id", mediaId: id, hint };
      }
    } catch {
      /* not JSON */
    }
  }

  try {
    const u = new URL(t);
    if (isAllowlistedMetaMediaHost(u.hostname)) {
      return { kind: "forward_url", url: t };
    }
  } catch {
    /* plain text */
  }

  return { kind: "none" };
}

/** Sidebar / list preview when content is media. */
export function formatMessageListPreview(content: string): string {
  const p = parseWhatsAppMediaContent(content);
  if (p.kind === "bot_transcription") {
    return "🎤 Voice message";
  }
  if (p.kind === "media_id") {
    if (p.caption) {
      return p.caption.length > 48 ? `${p.caption.slice(0, 45)}…` : p.caption;
    }
    if (p.hint === "audio") return "🎤 Voice message";
    if (p.hint === "image") return "📷 Photo";
    if (p.hint === "document") return "📄 Document";
    if (p.hint === "video") return "🎬 Video";
    return "📎 Media";
  }
  if (p.kind === "forward_url") {
    return "📎 Media";
  }

  const t = content.trim();
  try {
    const u = new URL(t);
    if (isAllowlistedMetaMediaHost(u.hostname)) return "📎 Media";
  } catch {
    /* */
  }

  return content;
}

/** Build `messages.content` for inbound WhatsApp Cloud API media (dashboard + proxy). */
/** Normalize Content-Type for browser `<audio>` playback (Meta often sends `audio/ogg; codecs=opus`). */
export function normalizeWhatsAppAudioContentType(
  contentType: string | null | undefined,
): string {
  const raw = (contentType ?? "").toLowerCase().split(";")[0]?.trim() ?? "";
  if (!raw) return "audio/ogg";
  if (raw.includes("ogg") || raw === "audio/opus") return "audio/ogg";
  if (raw.includes("mpeg") || raw.includes("mp3")) return "audio/mpeg";
  if (raw.includes("mp4") || raw.includes("m4a") || raw.includes("aac")) return "audio/mp4";
  if (raw.includes("amr")) return "audio/amr";
  if (raw.includes("webm")) return "audio/webm";
  if (raw.startsWith("audio/")) return raw;
  return "application/octet-stream";
}

export function formatInboundWaMediaContent(
  mediaId: string,
  waType:
    | "image"
    | "audio"
    | "video"
    | "sticker"
    | "document"
    | "voice",
  caption?: string | null,
): string {
  const id = mediaId.trim();
  if (!id) return caption?.trim() ?? "";

  const cap = caption?.trim();
  const prefix = cap ? `${cap}\n` : "";

  switch (waType) {
    case "audio":
    case "voice":
      return `${prefix}wa-media:${id}:audio`;
    case "sticker":
    case "image":
      return `${prefix}wa-media:${id}:image`;
    case "video":
      return `${prefix}wa-media:${id}:video`;
    case "document":
      return `${prefix}wa-media:${id}:document`;
    default:
      return `${prefix}wa-media:${id}`;
  }
}
