import { NextRequest, NextResponse } from "next/server";
import {
  normalizeWhatsAppRecipientDigits,
  resolveWhatsappPhoneNumberId,
  resolveMetaApiToken,
} from "@/lib/whatsappMetaPhone";
import { encodeAudioBufferForWhatsAppM4a } from "@/lib/convertWebmForWhatsApp";

/**
 * Admin outbound image/audio: bytes go to Meta Graph `/{phone-number-id}/media` only.
 * We do not persist media in Supabase Storage — the dashboard stores a short
 * `wa-media:<id>:<hint>` reference in `messages.content` for playback via `/api/whatsapp-media`.
 */
export const runtime = "nodejs";

/** Same Graph version as `/api/admin-send` (text), which is known-good for this app. */
const GRAPH_VERSION = "v18.0";

/** Pick container extension for FFmpeg input (MediaRecorder often uses `audio/mp4` + fMP4). */
function inferFfmpegAudioInputExt(lowerName: string, rawType: string): string | null {
  const n = lowerName.trim().toLowerCase();
  const t = rawType.trim().toLowerCase();
  if (t.includes("webm") || n.endsWith(".webm")) return "webm";
  if (
    t.startsWith("audio/ogg") ||
    t.includes("opus") ||
    n.endsWith(".ogg") ||
    n.endsWith(".opus")
  )
    return "ogg";
  if (
    t.startsWith("audio/mp4") ||
    t === "audio/m4a" ||
    t === "video/mp4" ||
    n.endsWith(".m4a") ||
    n.endsWith(".mp4")
  )
    return "m4a";
  if (t.startsWith("audio/mpeg") || t.includes("mp3") || n.endsWith(".mp3")) return "mp3";
  if (t.startsWith("audio/aac") || n.endsWith(".aac")) return "aac";
  if (t.startsWith("audio/amr") || n.endsWith(".amr")) return "amr";
  if (t.startsWith("audio/wav") || n.endsWith(".wav")) return "wav";
  return null;
}

function inferMimeFromFileName(fileName: string, kind: "image" | "audio"): string | null {
  const lower = fileName.trim().toLowerCase();
  if (kind === "image") {
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".jpe"))
      return "image/jpeg";
    if (lower.endsWith(".webp")) return "image/webp";
    return null;
  }
  if (lower.endsWith(".ogg") || lower.endsWith(".opus")) return "audio/ogg";
  if (lower.endsWith(".m4a") || lower.endsWith(".mp4")) return "audio/mp4";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".aac")) return "audio/aac";
  if (lower.endsWith(".amr")) return "audio/amr";
  return null;
}

function normalizeUploadMime(
  kind: "image" | "audio",
  rawType: string,
  fileName: string,
): string | null {
  let value = rawType.toLowerCase().trim();
  if (kind === "image") {
    if (value === "image/x-png" || value === "image/png") return "image/png";
    if (value === "image/jpg" || value === "image/jpeg" || value === "image/pjpeg")
      return "image/jpeg";
    if (value === "image/webp") return "image/webp";
    return inferMimeFromFileName(fileName, "image");
  }

  if (value.includes("webm")) return null;
  if (value.startsWith("audio/ogg")) return "audio/ogg";
  /** Meta upload `type` lists `audio/ogg` (OPUS only), not `audio/opus`. */
  if (value.startsWith("audio/opus")) return "audio/ogg";
  if (value.startsWith("audio/mp4") || value === "audio/m4a") return "audio/mp4";
  if (value.startsWith("audio/aac")) return "audio/aac";
  if (value.startsWith("audio/mpeg")) return "audio/mpeg";
  if (value.startsWith("audio/amr")) return "audio/amr";
  return inferMimeFromFileName(fileName, "audio");
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const phoneNumber = form.get("phone_number");
    const shopId = form.get("shop_id");
    const kindRaw = form.get("kind");
    const kind = typeof kindRaw === "string" ? kindRaw.trim().toLowerCase() : "image";
    const file =
      kind === "audio" ? form.get("audio") : form.get("image");

    if (typeof phoneNumber !== "string" || !phoneNumber.trim()) {
      return NextResponse.json(
        { error: "Missing or invalid 'phone_number'" },
        { status: 400 },
      );
    }
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: `Missing or invalid '${kind === "audio" ? "audio" : "image"}' file` },
        { status: 400 },
      );
    }

    const lowerName = (file.name || "").toLowerCase();
    const rawType = (file.type || "").toLowerCase();

    let normalizedType: string;
    let convertedAudio: { buffer: Buffer; mime: string; filename: string } | null = null;

    if (kind === "audio") {
      const rawBuf = Buffer.from(await file.arrayBuffer());
      if (rawBuf.length === 0) {
        return NextResponse.json(
          { error: "Empty audio recording" },
          { status: 400 },
        );
      }
      const ext = inferFfmpegAudioInputExt(lowerName, rawType);
      if (!ext) {
        return NextResponse.json(
          {
            error:
              "Unsupported or unknown audio recording format. Try Chrome/Edge, or install FFmpeg on the server.",
          },
          { status: 400 },
        );
      }
      try {
        convertedAudio = await encodeAudioBufferForWhatsAppM4a(rawBuf, ext);
        normalizedType = convertedAudio.mime;
      } catch (convErr) {
        console.error("[admin-send-media] Audio re-encode for WhatsApp failed:", convErr);
        return NextResponse.json(
          {
            error:
              "Voice could not be converted for WhatsApp. Ensure FFmpeg is installed (e.g. npm install ffmpeg-static) or set FFMPEG_PATH.",
            details: String(convErr),
          },
          { status: 500 },
        );
      }
    } else {
      const nt = normalizeUploadMime("image", file.type || "", file.name || "");
      if (!nt) {
        return NextResponse.json(
          { error: "Unsupported image format. Use JPEG, PNG, or WEBP." },
          { status: 400 },
        );
      }
      normalizedType = nt;
    }

    const shopIdClean = typeof shopId === "string" && shopId.trim() ? shopId.trim() : undefined;
    if (!shopIdClean) {
      return NextResponse.json(
        { error: "Missing shop_id — required to resolve business WhatsApp credentials" },
        { status: 400 },
      );
    }
    const token = await resolveMetaApiToken(shopIdClean);
    const phoneId = await resolveWhatsappPhoneNumberId(shopIdClean);
    if (!token || !phoneId) {
      return NextResponse.json(
        { error: "Business WhatsApp credentials not configured. Set them in Velo Admin." },
        { status: 500 },
      );
    }

    const cleanPhone = normalizeWhatsAppRecipientDigits(phoneNumber);
    if (!cleanPhone) {
      return NextResponse.json(
        { error: "phone_number is empty after normalisation" },
        { status: 400 },
      );
    }

    const uploadForm = new FormData();
    uploadForm.append("messaging_product", "whatsapp");
    uploadForm.append("type", normalizedType);

    if (convertedAudio) {
      const bytes = new Uint8Array(convertedAudio.buffer);
      uploadForm.append(
        "file",
        new Blob([bytes], { type: convertedAudio.mime }),
        convertedAudio.filename,
      );
    } else {
      const safeName =
        file.name ||
        (normalizedType === "image/png"
          ? "image.png"
          : normalizedType === "image/webp"
            ? "image.webp"
            : "image.jpg");
      uploadForm.append("file", file, safeName);
    }

    const uploadRes = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/media`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: uploadForm,
      },
    );

    const uploadBody = await uploadRes.json();
    if (!uploadRes.ok || typeof uploadBody?.id !== "string") {
      console.error("[admin-send-media] upload failed:", uploadBody);
      return NextResponse.json(
        { error: "Failed to upload media to WhatsApp", details: uploadBody },
        { status: 500 },
      );
    }

    const mediaId = uploadBody.id as string;
    /** Basic `audio: { id }` — same delivery path as images; avoids voice-note edge cases. */
    const payload =
      kind === "audio"
        ? {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: cleanPhone,
            type: "audio",
            audio: { id: mediaId },
          }
        : {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: cleanPhone,
            type: "image",
            image: { id: mediaId },
          };

    const sendRes = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      },
    );

    const sendBody = (await sendRes.json()) as {
      messages?: Array<{ id?: string }>;
      error?: unknown;
    };
    if (!sendRes.ok) {
      console.error("[admin-send-media] send failed:", sendBody);
      const label = kind === "audio" ? "audio message" : "image message";
      return NextResponse.json(
        { error: `Failed to send ${label}`, details: sendBody },
        { status: 500 },
      );
    }

    if (sendBody.error != null) {
      console.error("[admin-send-media] send body contains error:", sendBody);
      return NextResponse.json(
        { error: "WhatsApp API returned an error payload", details: sendBody },
        { status: 502 },
      );
    }

    const waMessageIdRaw = sendBody?.messages?.[0]?.id;
    if (typeof waMessageIdRaw !== "string" || !waMessageIdRaw.trim()) {
      console.error(
        "[admin-send-media] send HTTP OK but no messages[0].id — not accepted for delivery:",
        sendBody,
      );
      return NextResponse.json(
        {
          error:
            "WhatsApp did not return a message id. The audio may not have been queued for delivery.",
          details: sendBody,
        },
        { status: 502 },
      );
    }
    const waMessageId = waMessageIdRaw.trim();

    console.log("[admin-send-media] queued on WhatsApp", {
      kind,
      mime: normalizedType,
      reencoded: kind === "audio",
    });

    return NextResponse.json(
      {
        ok: true,
        media_id: mediaId,
        wa_message_id: waMessageId,
        data: sendBody,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("[admin-send-media] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
