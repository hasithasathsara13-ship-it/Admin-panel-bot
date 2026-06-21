import type { SupabaseClient } from "@supabase/supabase-js";

import { parseWhatsAppMediaContent } from "@/lib/whatsappMediaContent";

/** Replace a recent `[Voice Note]: …` row saved by the external bot with playable `wa-media:…:audio`. */
export async function upgradeRecentVoiceTranscript(
  admin: SupabaseClient,
  shopId: string,
  phone: string,
  playableContent: string,
  waMessageId: string | null,
): Promise<boolean> {
  const trimmed = playableContent.trim();
  if (!trimmed.startsWith("wa-media:")) return false;

  const parsed = parseWhatsAppMediaContent(trimmed);
  if (parsed.kind !== "media_id" || parsed.hint !== "audio") return false;

  const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: rows, error } = await admin
    .from("messages")
    .select("id, content")
    .eq("shop_id", shopId)
    .eq("phone_number", phone)
    .eq("role", "user")
    .is("wa_message_id", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    console.warn("[whatsapp-webhook] transcript lookup:", error.message);
    return false;
  }

  for (const row of rows ?? []) {
    if (parseWhatsAppMediaContent(String(row.content ?? "")).kind !== "bot_transcription") {
      continue;
    }
    const patch: Record<string, unknown> = { content: trimmed };
    if (waMessageId) patch.wa_message_id = waMessageId;
    const { error: upErr } = await admin.from("messages").update(patch).eq("id", row.id);
    if (upErr) {
      console.error("[whatsapp-webhook] transcript upgrade:", upErr);
      return false;
    }
    return true;
  }

  return false;
}

/** Remove `[Voice Note]: …` rows after we stored playable audio (bot may insert slightly later). */
export async function deleteRecentVoiceTranscripts(
  admin: SupabaseClient,
  shopId: string,
  phone: string,
): Promise<void> {
  const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: rows, error } = await admin
    .from("messages")
    .select("id, content")
    .eq("shop_id", shopId)
    .eq("phone_number", phone)
    .eq("role", "user")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(12);

  if (error) return;

  for (const row of rows ?? []) {
    if (parseWhatsAppMediaContent(String(row.content ?? "")).kind !== "bot_transcription") {
      continue;
    }
    await admin.from("messages").delete().eq("id", row.id);
  }
}

/** Forward the raw Meta payload to your existing bot so AI replies keep working. */
export async function forwardWebhookToBot(
  rawBody: string,
  signature: string | null,
): Promise<void> {
  const url = process.env.WHATSAPP_BOT_WEBHOOK_URL?.trim();
  if (!url) return;

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (signature) headers["x-hub-signature-256"] = signature;
    const secret = process.env.WHATSAPP_BOT_WEBHOOK_SECRET?.trim();
    if (secret) headers["x-velo-forward-secret"] = secret;

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: rawBody,
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("[whatsapp-webhook] bot forward status:", res.status, text.slice(0, 200));
    }
  } catch (e) {
    console.warn("[whatsapp-webhook] bot forward failed:", e);
  }
}

/** Hide transcript-only bubbles when a playable voice row exists within a few seconds. */
export function shouldHideRedundantVoiceTranscript(
  content: string,
  isoTime: string,
  peers: { content: string; isoTime: string; isCustomer: boolean }[],
): boolean {
  if (parseWhatsAppMediaContent(content).kind !== "bot_transcription") return false;
  const t = Date.parse(isoTime);
  if (Number.isNaN(t)) return false;

  return peers.some((p) => {
    if (!p.isCustomer) return false;
    const parsed = parseWhatsAppMediaContent(p.content);
    if (parsed.kind !== "media_id" || parsed.hint !== "audio") return false;
    const pt = Date.parse(p.isoTime);
    if (Number.isNaN(pt)) return false;
    return Math.abs(pt - t) < 20_000;
  });
}

export function filterRedundantVoiceTranscripts<T extends { content: string; isoTime: string; sender: string }>(
  msgs: T[],
): T[] {
  const peers = msgs.map((m) => ({
    content: m.content,
    isoTime: m.isoTime,
    isCustomer: m.sender === "customer",
  }));
  return msgs.filter(
    (m) =>
      !shouldHideRedundantVoiceTranscript(m.content, m.isoTime, peers),
  );
}
