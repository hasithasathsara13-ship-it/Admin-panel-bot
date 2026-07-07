"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Download, File, FileText, ImageOff, Loader2, Mic } from "lucide-react";
import type { WaMediaKindHint } from "@/lib/whatsappMediaContent";
import { getActiveShopId } from "@/lib/activeShopId";

function mediaSrc(mediaId: string, extra = ""): string {
  const shopId = typeof window !== "undefined" ? getActiveShopId() : null;
  const shopParam = shopId ? `&shop_id=${encodeURIComponent(shopId)}` : "";
  return `/api/whatsapp-media?media_id=${encodeURIComponent(mediaId)}${shopParam}${extra}`;
}

export type WaMediaKindHintExtended = WaMediaKindHint | "document" | "video";

const chatImgClass =
  "mt-1 w-full max-w-full max-h-[min(55dvh,26rem)] rounded-xl border border-black/10 object-contain";
const chatVideoClass =
  "mt-1 w-full max-w-full max-h-[min(55dvh,26rem)] rounded-xl border border-black/10";

function bubbleAudioWrap(isAI: boolean, children: ReactNode) {
  return (
    <div
      className={[
        "flex min-w-[12rem] max-w-full items-center gap-2 mt-1 px-1 py-1 rounded-xl",
        isAI ? "bg-white/10" : "bg-black/5",
      ].join(" ")}
    >
      <Mic
        className={[
          "w-4 h-4 flex-shrink-0",
          isAI ? "text-white/70" : "text-[var(--color-text-tertiary)]",
        ].join(" ")}
      />
      {children}
    </div>
  );
}

function WaAudioPlayer({ src, isAI }: { src: string; isAI: boolean }) {
  const [failed, setFailed] = useState(false);
  const [iosSrc, setIosSrc] = useState<string | null>(null);
  const [decoding, setDecoding] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    if (typeof navigator !== "undefined") {
      const ua = navigator.userAgent;
      const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      setIsIOS(ios);
      if (ios) {
        // On iOS, decode OGG/Opus client-side and create a WAV blob URL
        void decodeForIOS(src);
      }
    }
  }, [src]);

  async function decodeForIOS(audioSrc: string) {
    setDecoding(true);
    try {
      const res = await fetch(audioSrc);
      if (!res.ok) { setFailed(true); setDecoding(false); return; }
      const contentType = res.headers.get("content-type") || "";
      
      // If server already transcoded to mp4/aac, use it directly
      if (contentType.includes("mp4") || contentType.includes("aac") || contentType.includes("mpeg")) {
        const blob = await res.blob();
        setIosSrc(URL.createObjectURL(blob));
        setDecoding(false);
        return;
      }

      // Try decoding OGG/Opus using ogg-opus-decoder
      const arrayBuf = await res.arrayBuffer();
      try {
        const { OggOpusDecoder } = await import("ogg-opus-decoder");
        const decoder = new OggOpusDecoder();
        await decoder.ready;
        const decoded = await decoder.decode(new Uint8Array(arrayBuf));
        
        // Convert decoded PCM to WAV blob
        const wavBlob = pcmToWavBlob(decoded.channelData, decoded.sampleRate);
        setIosSrc(URL.createObjectURL(wavBlob));
        decoder.free();
      } catch {
        // If opus decoder fails, try Web Audio API decodeAudioData as last resort
        try {
          const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
          const audioBuf = await audioCtx.decodeAudioData(arrayBuf);
          const channels: Float32Array[] = [];
          for (let i = 0; i < audioBuf.numberOfChannels; i++) {
            channels.push(audioBuf.getChannelData(i));
          }
          const wavBlob = pcmToWavBlob(channels, audioBuf.sampleRate);
          setIosSrc(URL.createObjectURL(wavBlob));
          await audioCtx.close();
        } catch {
          setFailed(true);
        }
      }
    } catch {
      setFailed(true);
    }
    setDecoding(false);
  }

  if (failed) {
    return (
      <div className="flex flex-col gap-1.5 py-0.5">
        <span className="text-[12px] opacity-70">Voice message</span>
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          download="voice-message.m4a"
          className={[
            "inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-lg transition-colors",
            isAI ? "bg-white/20 text-white hover:bg-white/30" : "bg-[var(--color-accent-light)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20",
          ].join(" ")}
        >
          <Download className="w-3 h-3" />
          Play / Download
        </a>
      </div>
    );
  }

  if (isIOS && decoding) {
    return bubbleAudioWrap(
      isAI,
      <div className="flex items-center gap-2 py-1">
        <Loader2 className="w-4 h-4 animate-spin opacity-60" />
        <span className="text-[12px] opacity-70">Loading voice…</span>
      </div>,
    );
  }

  return bubbleAudioWrap(
    isAI,
    <audio
      controls
      preload={isIOS ? "auto" : "metadata"}
      src={iosSrc ?? src}
      onError={() => { if (!isIOS) setFailed(true); }}
      className="h-9 min-w-0 flex-1"
      style={{ colorScheme: isAI ? "dark" : "light" }}
      playsInline
    />,
  );
}

/** Convert decoded PCM Float32Array channels to a WAV Blob. */
function pcmToWavBlob(channels: Float32Array[], sampleRate: number): Blob {
  const numChannels = channels.length;
  const length = channels[0].length;
  const interleaved = new Float32Array(length * numChannels);
  
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      interleaved[i * numChannels + ch] = channels[ch][i];
    }
  }
  
  const buffer = new ArrayBuffer(44 + interleaved.length * 2);
  const view = new DataView(buffer);
  
  // WAV header
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + interleaved.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, interleaved.length * 2, true);
  
  // PCM samples
  let offset = 44;
  for (let i = 0; i < interleaved.length; i++) {
    const s = Math.max(-1, Math.min(1, interleaved[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }
  
  return new Blob([buffer], { type: "audio/wav" });
}

function TryImageThenAudio({ src, isAI }: { src: string; isAI: boolean }) {
  const [mode, setMode] = useState<"img" | "audio" | "fail">("img");

  if (mode === "img") {
    return (
      <img
        src={src}
        alt=""
        onError={() => setMode("audio")}
        className={chatImgClass}
        loading="lazy"
      />
    );
  }

  if (mode === "audio") {
    return <WaAudioPlayer src={src} isAI={isAI} />;
  }

  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      className={[
        "text-[12px] underline font-medium",
        isAI ? "text-white/90" : "text-[var(--color-accent)]",
      ].join(" ")}
    >
      Open attachment
    </a>
  );
}

/** Friendly label for document MIME types. */
function docLabel(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("pdf")) return "PDF Document";
  if (m.includes("wordprocessingml") || m.includes("msword")) return "Word Document";
  if (m.includes("spreadsheetml") || m.includes("ms-excel") || m.includes("excel")) return "Excel Spreadsheet";
  if (m.includes("presentationml") || m.includes("powerpoint")) return "PowerPoint";
  if (m.includes("zip") || m.includes("compressed") || m.includes("archive")) return "Archive (ZIP)";
  if (m.includes("text/plain")) return "Text File";
  if (m.includes("text/csv")) return "CSV File";
  if (m.includes("json")) return "JSON File";
  return "Document";
}

/** Extension hint from MIME. */
function docExt(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("pdf")) return ".pdf";
  if (m.includes("wordprocessingml")) return ".docx";
  if (m.includes("msword")) return ".doc";
  if (m.includes("spreadsheetml")) return ".xlsx";
  if (m.includes("ms-excel")) return ".xls";
  if (m.includes("presentationml")) return ".pptx";
  if (m.includes("powerpoint")) return ".ppt";
  if (m.includes("zip")) return ".zip";
  if (m.includes("text/plain")) return ".txt";
  if (m.includes("text/csv")) return ".csv";
  return "";
}

/** Returns true if the MIME type represents a document (not image/audio/video). */
function isDocumentMime(mime: string): boolean {
  const m = mime.toLowerCase();
  if (m.startsWith("image/") || m.startsWith("audio/") || m.startsWith("video/")) return false;
  if (m === "application/octet-stream") return false;
  if (
    m.includes("pdf") ||
    m.includes("word") ||
    m.includes("document") ||
    m.includes("spreadsheet") ||
    m.includes("excel") ||
    m.includes("presentation") ||
    m.includes("powerpoint") ||
    m.includes("text/plain") ||
    m.includes("text/csv") ||
    m.includes("json") ||
    m.includes("zip") ||
    m.includes("compressed") ||
    m.includes("archive") ||
    m.startsWith("application/")
  ) {
    return true;
  }
  return false;
}

function DocumentAttachment({ src, mime, isAI }: { src: string; mime: string; isAI: boolean }) {
  const label = docLabel(mime);
  const ext = docExt(mime);
  const isPdf = mime.toLowerCase().includes("pdf");

  return (
    <div
      className={[
        "mt-1 flex items-center gap-3 rounded-xl border px-3 py-2.5 min-w-[200px] max-w-[280px]",
        isAI
          ? "border-white/20 bg-white/10"
          : "border-[var(--color-border)] bg-[var(--color-surface-secondary)]",
      ].join(" ")}
    >
      <div
        className={[
          "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg",
          isPdf ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600",
        ].join(" ")}
      >
        {isPdf ? <FileText className="w-5 h-5" /> : <File className="w-5 h-5" />}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={[
            "text-[13px] font-medium truncate",
            isAI ? "text-white" : "text-[var(--color-text-primary)]",
          ].join(" ")}
        >
          {label}
        </div>
        <div
          className={[
            "text-[11px] uppercase tracking-wide",
            isAI ? "text-white/60" : "text-[var(--color-text-tertiary)]",
          ].join(" ")}
        >
          {ext || mime.split("/").pop()}
        </div>
      </div>
      <a
        href={src}
        download
        target="_blank"
        rel="noopener noreferrer"
        className={[
          "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-colors",
          isAI
            ? "bg-white/15 text-white hover:bg-white/25"
            : "bg-[var(--color-surface-hover)] text-[var(--color-accent)] hover:bg-[var(--color-accent-light)]",
        ].join(" ")}
        title="Download"
      >
        <Download className="w-4 h-4" />
      </a>
    </div>
  );
}

/** Renders WhatsApp Cloud API media using /api/whatsapp-media (Bearer + media id). */
export function WaMediaAttachment({
  mediaId,
  hint,
  isAI,
}: {
  mediaId: string;
  hint?: WaMediaKindHint;
  isAI: boolean;
}) {
  const src = mediaSrc(mediaId);
  const [mime, setMime] = useState<string | null>(null);
  const [imgErr, setImgErr] = useState(false);
  const [metaErr, setMetaErr] = useState(false);

  useEffect(() => {
    if (hint === "audio" || hint === "image") return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(mediaSrc(mediaId, "&info=1"));
        if (!r.ok) {
          if (!cancelled) {
            setMetaErr(true);
            setMime("application/octet-stream");
          }
          return;
        }
        const j = (await r.json()) as { mime_type?: string };
        if (!cancelled) {
          setMime(
            typeof j.mime_type === "string"
              ? j.mime_type
              : "application/octet-stream",
          );
        }
      } catch {
        if (!cancelled) {
          setMetaErr(true);
          setMime("application/octet-stream");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mediaId, hint]);

  if (hint === "audio") {
    if (metaErr) {
      return (
        <span className="text-[12px] opacity-70">Voice message (media expired or token issue)</span>
      );
    }
    return <WaAudioPlayer src={src} isAI={isAI} />;
  }

  if (hint === "image") {
    return imgErr ? (
      <div className="flex items-center gap-1.5 text-[12px] opacity-60 py-1">
        <ImageOff className="w-4 h-4" />
        <span>Image unavailable</span>
      </div>
    ) : (
      <div className="relative group mt-1">
        <img
          src={src}
          alt="WhatsApp attachment"
          onError={() => setImgErr(true)}
          className={chatImgClass}
          loading="lazy"
        />
        <a
          href={src}
          download
          target="_blank"
          rel="noopener noreferrer"
          className="absolute top-2 right-2 flex h-8 w-8 items-center justify-center rounded-lg bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
          title="Download image"
        >
          <Download className="w-4 h-4" />
        </a>
      </div>
    );
  }

  if (hint === "document") {
    return <DocumentAttachment src={src} mime={mime || "application/octet-stream"} isAI={isAI} />;
  }

  if (hint === "video") {
    return (
      <video
        src={src}
        controls
        className={chatVideoClass}
      />
    );
  }

  if (!hint && mime === null) {
    return (
      <div className="flex items-center gap-2 py-1 text-[12px] opacity-70">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading media…
      </div>
    );
  }

  const m = mime || "";
  if (m.startsWith("audio/") || m.includes("ogg") || m.includes("opus")) {
    return <WaAudioPlayer src={src} isAI={isAI} />;
  }

  if (m.startsWith("image/") || m === "image/webp") {
    return imgErr ? (
      <div className="flex items-center gap-1.5 text-[12px] opacity-60 py-1">
        <ImageOff className="w-4 h-4" />
        <span>Image unavailable</span>
      </div>
    ) : (
      <div className="relative group mt-1">
        <img
          src={src}
          alt="WhatsApp attachment"
          onError={() => setImgErr(true)}
          className={chatImgClass}
          loading="lazy"
        />
        <a
          href={src}
          download
          target="_blank"
          rel="noopener noreferrer"
          className="absolute top-2 right-2 flex h-8 w-8 items-center justify-center rounded-lg bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
          title="Download image"
        >
          <Download className="w-4 h-4" />
        </a>
      </div>
    );
  }

  if (m.startsWith("video/")) {
    return (
      <video
        src={src}
        controls
        className={chatVideoClass}
      />
    );
  }

  // Document types (PDF, Word, Excel, etc.)
  if (isDocumentMime(m)) {
    return <DocumentAttachment src={src} mime={m} isAI={isAI} />;
  }

  if (m === "application/octet-stream" || !m) {
    return <TryImageThenAudio src={src} isAI={isAI} />;
  }

  // Fallback for any other application/* types
  return <DocumentAttachment src={src} mime={m} isAI={isAI} />;
}

/** Meta CDN URL stored in DB — browser cannot fetch it without Bearer; try image then audio. */
export function WaForwardAttachment({
  forwardUrl,
  isAI,
}: {
  forwardUrl: string;
  isAI: boolean;
}) {
  const shopId = typeof window !== "undefined" ? getActiveShopId() : null;
  const shopParam = shopId ? `&shop_id=${encodeURIComponent(shopId)}` : "";
  const src = `/api/whatsapp-media?forward_url=${encodeURIComponent(forwardUrl)}${shopParam}`;
  return <TryImageThenAudio src={src} isAI={isAI} />;
}
