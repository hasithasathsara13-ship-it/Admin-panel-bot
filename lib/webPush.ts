import webpush from "web-push";
import { supabaseAdminForWhatsApp as supabaseAdmin } from "./whatsappMetaPhone";

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:admin@veloai.pro";

let configured = false;
export function ensureVapidConfigured(): boolean {
  if (configured) return true;
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return false;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  configured = true;
  return true;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

/**
 * Send a web-push notification to every subscription registered for a shop.
 * Silently drops (deletes) subscriptions that Meta/Apple/Google report as gone.
 */
export async function sendPushToShop(shopId: string, payload: PushPayload): Promise<void> {
  if (!shopId) return;
  if (!ensureVapidConfigured() || !supabaseAdmin) return;

  const { data, error } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("shop_id", shopId);

  if (error || !data?.length) return;

  const body = JSON.stringify(payload);

  await Promise.all(
    (data as Array<{ id: string; endpoint: string; p256dh: string; auth: string }>).map(
      async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            body,
          );
        } catch (err: unknown) {
          const statusCode =
            typeof err === "object" && err !== null && "statusCode" in err
              ? Number((err as { statusCode?: number }).statusCode)
              : 0;
          // 404/410 → subscription expired or unsubscribed; clean it up.
          if (statusCode === 404 || statusCode === 410) {
            await supabaseAdmin?.from("push_subscriptions").delete().eq("id", sub.id);
          }
        }
      },
    ),
  );
}
