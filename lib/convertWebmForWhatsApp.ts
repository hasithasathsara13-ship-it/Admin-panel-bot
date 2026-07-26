import { randomBytes } from "crypto";
import { unlink, writeFile, readFile } from "fs/promises";
import * as path from "path";
import * as os from "os";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";

let configured = false;

const ALLOWED_INPUT_EXT = new Set([
  "webm",
  "ogg",
  "m4a",
  "mp4",
  "mp3",
  "aac",
  "amr",
  "wav",
]);

function ensureFfmpegPath() {
  if (configured) return;
  const fromEnv = process.env.FFMPEG_PATH?.trim();
  const bin =
    typeof fromEnv === "string" && fromEnv.length > 0
      ? path.resolve(fromEnv)
      : ffmpegStatic &&
          typeof ffmpegStatic === "string" &&
          ffmpegStatic.length > 0
        ? path.resolve(ffmpegStatic)
        : "";
  if (!bin) {
    throw new Error(
      "FFmpeg not found. Set FFMPEG_PATH or install ffmpeg-static (npm install ffmpeg-static).",
    );
  }
  ffmpeg.setFfmpegPath(bin);
  configured = true;
}

export type WhatsAppAudioMime = "audio/mp4";

/**
 * Re-encode arbitrary browser / file audio to mono AAC in MP4 (`.m4a`, `audio/mp4`).
 * MediaRecorder `audio/mp4` is often fragmented MP4; Meta accepts the upload but the
 * message may never appear on the recipient. Normalizing through FFmpeg fixes that.
 */
export async function encodeAudioBufferForWhatsAppM4a(
  inputBuffer: Buffer,
  inputExt: string,
): Promise<{ buffer: Buffer; mime: WhatsAppAudioMime; filename: string }> {
  ensureFfmpegPath();
  const ext = inputExt.toLowerCase().replace(/^\./, "");
  if (!ALLOWED_INPUT_EXT.has(ext)) {
    throw new Error(`Unsupported audio input extension for re-encode: ${inputExt}`);
  }

  const id = randomBytes(8).toString("hex");
  const inPath = path.join(os.tmpdir(), `wa-audio-in-${id}.${ext}`);
  const m4aPath = path.join(os.tmpdir(), `wa-audio-out-${id}.m4a`);

  await writeFile(inPath, inputBuffer);

  try {
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      ffmpeg(inPath)
        .noVideo()
        .audioChannels(1)
        .audioFrequency(44_100)
        .audioCodec("aac")
        .audioBitrate("96k")
        .addOutputOptions(["-profile:a", "aac_low", "-movflags", "+faststart"])
        .format("mp4")
        .on("end", () => {
          void readFile(m4aPath).then(resolve).catch(reject);
        })
        .on("error", reject)
        .save(m4aPath);
    });
    if (!buffer.length) {
      throw new Error("FFmpeg produced an empty output buffer");
    }
    return { buffer, mime: "audio/mp4", filename: "voice.m4a" };
  } catch (err) {
    console.error("[encodeAudioBufferForWhatsAppM4a] failed:", err);
    throw err;
  } finally {
    await unlink(inPath).catch(() => {});
    await unlink(m4aPath).catch(() => {});
  }
}

/** @deprecated use {@link encodeAudioBufferForWhatsAppM4a} with ext `"webm"` */
export async function convertWebmForWhatsApp(
  webmBuffer: Buffer,
): Promise<{ buffer: Buffer; mime: WhatsAppAudioMime; filename: string }> {
  return encodeAudioBufferForWhatsAppM4a(webmBuffer, "webm");
}

/**
 * Convert audio to OGG Opus format (for Baileys/WhatsApp Web voice notes).
 * WhatsApp Web PTT requires OGG Opus, mono, 48kHz.
 */
export async function encodeAudioBufferForBaileysOgg(
  inputBuffer: Buffer,
  inputExt: string,
): Promise<{ buffer: Buffer; mime: string; filename: string }> {
  ensureFfmpegPath();
  const ext = inputExt.toLowerCase().replace(/^\./, "");
  if (!ALLOWED_INPUT_EXT.has(ext)) {
    throw new Error(`Unsupported audio input extension: ${inputExt}`);
  }

  const id = randomBytes(8).toString("hex");
  const inPath = path.join(os.tmpdir(), `wa-ogg-in-${id}.${ext}`);
  const oggPath = path.join(os.tmpdir(), `wa-ogg-out-${id}.ogg`);

  await writeFile(inPath, inputBuffer);

  try {
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      ffmpeg(inPath)
        .noVideo()
        .audioChannels(1)
        .audioFrequency(48000)
        .audioCodec("libopus")
        .audioBitrate("32k")
        // WhatsApp voice notes (PTT) must be Opus/OGG. Android is lenient, but iOS
        // WhatsApp is strict about OGG page structure and requires a clean, single
        // continuous Opus stream with VoIP application and standard 20ms frames.
        // Fragmenting flags (flush_packets/packet_loss) make iOS reject the file
        // with "audio no longer available", so we keep the stream simple + clean.
        .addOutputOptions([
          "-application",
          "voip",
          "-frame_duration",
          "20",
          "-vbr",
          "on",
          "-compression_level",
          "10",
          "-avoid_negative_ts",
          "make_zero",
          "-map_metadata",
          "-1",
        ])
        .format("ogg")
        .on("end", () => {
          void readFile(oggPath).then(resolve).catch(reject);
        })
        .on("error", reject)
        .save(oggPath);
    });
    if (!buffer.length) {
      throw new Error("FFmpeg produced an empty OGG buffer");
    }
    return { buffer, mime: "audio/ogg; codecs=opus", filename: "voice.ogg" };
  } catch (err) {
    console.error("[encodeAudioBufferForBaileysOgg] failed:", err);
    throw err;
  } finally {
    await unlink(inPath).catch(() => {});
    await unlink(oggPath).catch(() => {});
  }
}
