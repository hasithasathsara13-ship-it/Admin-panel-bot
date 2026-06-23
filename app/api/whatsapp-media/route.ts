import { NextRequest, NextResponse } from "next/server";
import {
  isAllowlistedMetaMediaHost,
  normalizeWhatsAppAudioContentType,
} from "@/lib/whatsappMediaContent";
import { resolveMetaApiToken } from "@/lib/whatsappMetaPhone";

/**
 * Proxies WhatsApp Cloud API media for the dashboard.
 *
 * Inbound webhook handlers should persist `messages.content` as:
 *   wa-media:<GRAPH_MEDIA_ID>
 * Voice notes (faster UI): wa-media:<ID>:audio
 * Photos: wa-media:<ID>:image
 *
 * Raw Meta CDN URLs in the DB are also supported if the hostname passes
 * `isAllowlistedMetaMediaHost` (still need META_API_TOKEN on the server).
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GRAPH = "https://graph.facebook.com/v18.0";

type MetaMediaMeta = { url?: string; mime_type?: string; error?: unknown };

async function fetchMediaMeta(
  mediaId: string,
  token: string,
): Promise<MetaMediaMeta> {
  const u = new URL(`${GRAPH}/${encodeURIComponent(mediaId)}`);
  u.searchParams.set("fields", "mime_type,url");
  const res = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const json = (await res.json()) as MetaMediaMeta;
  if (!res.ok) {
    return { error: json };
  }
  return json;
}

function decodeForwardUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (!isAllowlistedMetaMediaHost(u.hostname)) return null;
    return u;
  } catch {
    return null;
  }
}

/**
 * GET /api/whatsapp-media?media_id=…           → stream bytes (for <img>/<audio>)
 * GET /api/whatsapp-media?media_id=…&info=1     → { mime_type } only
 * GET /api/whatsapp-media?forward_url=…         → stream from Meta CDN (Bearer required)
 * GET /api/whatsapp-media?forward_url=…&info=1 → { mime_type } via GET headers
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const shopId = url.searchParams.get("shop_id") || undefined;
  const token = await resolveMetaApiToken(shopId);
  if (!token) {
    return NextResponse.json(
      { error: "Business WhatsApp credentials not configured" },
      { status: 500 },
    );
  }

  const mediaId = url.searchParams.get("media_id");
  const forwardRaw = url.searchParams.get("forward_url");
  const infoOnly = url.searchParams.get("info") === "1";

  if (mediaId) {
    const meta = await fetchMediaMeta(mediaId, token);
    if (meta.error || !meta.url) {
      console.error("[whatsapp-media] media meta error:", meta.error);
      return NextResponse.json(
        { error: "Failed to resolve media", details: meta.error },
        { status: 502 },
      );
    }
    if (infoOnly) {
      return NextResponse.json({ mime_type: meta.mime_type ?? null });
    }
    const bin = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!bin.ok) {
      const errText = await bin.text();
      console.error("[whatsapp-media] binary fetch error:", bin.status, errText);
      return NextResponse.json(
        { error: "Failed to download media" },
        { status: 502 },
      );
    }
    const rawCt =
      bin.headers.get("content-type") ||
      meta.mime_type ||
      "application/octet-stream";
    const ct = rawCt.toLowerCase().includes("audio")
      ? normalizeWhatsAppAudioContentType(rawCt, meta.mime_type)
      : rawCt;
    return new NextResponse(bin.body, {
      status: 200,
      headers: {
        "Content-Type": ct,
        "Cache-Control": "private, max-age=300",
        ...(ct.startsWith("audio/")
          ? { "Accept-Ranges": "bytes" }
          : {}),
      },
    });
  }

  if (forwardRaw) {
    const decoded = decodeURIComponent(forwardRaw);
    const parsed = decodeForwardUrl(decoded);
    if (!parsed) {
      return NextResponse.json({ error: "URL not allowed" }, { status: 400 });
    }

    if (infoOnly) {
      return NextResponse.json(
        { error: "info=1 is only supported with media_id" },
        { status: 400 },
      );
    }

    const bin = await fetch(parsed.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!bin.ok) {
      return NextResponse.json(
        { error: "Failed to download media" },
        { status: 502 },
      );
    }
    const ct = bin.headers.get("content-type") || "application/octet-stream";
    return new NextResponse(bin.body, {
      status: 200,
      headers: {
        "Content-Type": ct,
        "Cache-Control": "private, max-age=300",
      },
    });
  }

  return NextResponse.json(
    { error: "Provide media_id or forward_url" },
    { status: 400 },
  );
}
