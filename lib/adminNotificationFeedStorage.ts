export type AdminNotificationFeedItem = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
};

const STORAGE_PREFIX = "admin_notification_feed_v1:";

function storageKey(shopId: string) {
  return `${STORAGE_PREFIX}${shopId}`;
}

export function loadAdminNotificationFeed(shopId: string): AdminNotificationFeedItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(shopId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (row): row is AdminNotificationFeedItem =>
          row != null &&
          typeof row === "object" &&
          typeof (row as AdminNotificationFeedItem).id === "string" &&
          typeof (row as AdminNotificationFeedItem).title === "string" &&
          typeof (row as AdminNotificationFeedItem).body === "string" &&
          typeof (row as AdminNotificationFeedItem).createdAt === "string",
      )
      .slice(0, 30);
  } catch {
    return [];
  }
}

export function saveAdminNotificationFeed(shopId: string, items: AdminNotificationFeedItem[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(shopId), JSON.stringify(items.slice(0, 30)));
  } catch {
    // ignore quota / private mode
  }
}
