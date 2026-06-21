export type SavedContactsMap = Record<string, string>;

const key = (shopId: string) => `wa_chat_contacts_${shopId}`;

export function loadSavedContacts(shopId: string): SavedContactsMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(key(shopId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: SavedContactsMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" && v.trim()) out[k] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

export function persistContactName(
  shopId: string,
  phone: string,
  displayName: string,
): SavedContactsMap {
  const map = loadSavedContacts(shopId);
  const t = displayName.trim();
  if (!t) delete map[phone];
  else map[phone] = t;
  localStorage.setItem(key(shopId), JSON.stringify(map));
  return { ...map };
}
