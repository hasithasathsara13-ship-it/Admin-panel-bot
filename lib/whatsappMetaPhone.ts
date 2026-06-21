import { createClient, SupabaseClient } from "@supabase/supabase-js";

export type BusinessRow = {
  id: string;
  business_name: string | null;
  whatsapp_number: string | null;
  meta_phone_id?: string | null;
};

/** Match inbound webhook normalization — Meta `to` must be digits only (country code, no +). */
export function normalizeWhatsAppRecipientDigits(raw: string): string {
  return raw.replace(/\D/g, "");
}

export const supabaseAdminForWhatsApp: SupabaseClient | null =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
      )
    : null;

export async function resolveBusinessForShop(
  shopId: string,
): Promise<BusinessRow | null> {
  if (!supabaseAdminForWhatsApp) return null;

  const businessSelect = "*";

  const primary = await supabaseAdminForWhatsApp
    .from("businesses")
    .select(businessSelect)
    .eq("id", shopId)
    .maybeSingle();

  if (!primary.error && primary.data) return primary.data as BusinessRow;

  const shopResult = await supabaseAdminForWhatsApp
    .from("shops")
    .select("id, business_id, owner_user_id")
    .eq("id", shopId)
    .maybeSingle();

  if (shopResult.error || !shopResult.data) return null;

  const shop = shopResult.data as Record<string, unknown>;
  const businessId =
    typeof shop.business_id === "string" && shop.business_id.trim()
      ? shop.business_id
      : null;
  const ownerUserId =
    typeof shop.owner_user_id === "string" && shop.owner_user_id.trim()
      ? shop.owner_user_id
      : null;

  if (businessId) {
    const byBusinessId = await supabaseAdminForWhatsApp
      .from("businesses")
      .select(businessSelect)
      .eq("id", businessId)
      .maybeSingle();

    if (!byBusinessId.error && byBusinessId.data)
      return byBusinessId.data as BusinessRow;
  }

  if (ownerUserId) {
    const byOwner = await supabaseAdminForWhatsApp
      .from("businesses")
      .select(businessSelect)
      .eq("owner_user_id", ownerUserId)
      .maybeSingle();

    if (!byOwner.error && byOwner.data) return byOwner.data as BusinessRow;
  }

  const byShopAsOwner = await supabaseAdminForWhatsApp
    .from("businesses")
    .select(businessSelect)
    .eq("owner_user_id", shopId)
    .maybeSingle();

  if (!byShopAsOwner.error && byShopAsOwner.data)
    return byShopAsOwner.data as BusinessRow;

  return null;
}

/**
 * Same priority as delivery notifications: per-business Meta ID, then env.
 * Accepts META_PHONE_NUMBER_ID (used across the app) and META_PHONE_ID (legacy alias).
 */
export function whatsappPhoneNumberIdFromBusiness(
  business: BusinessRow | null,
): string | null {
  const fromRow =
    typeof business?.meta_phone_id === "string"
      ? business.meta_phone_id.trim()
      : "";
  if (fromRow) return fromRow;
  return (
    process.env.META_PHONE_NUMBER_ID ||
    process.env.META_PHONE_ID ||
    null
  );
}

export async function resolveWhatsappPhoneNumberId(
  shopId: string | null | undefined,
): Promise<string | null> {
  if (shopId && supabaseAdminForWhatsApp) {
    const business = await resolveBusinessForShop(shopId);
    const id = whatsappPhoneNumberIdFromBusiness(business);
    if (id) return id;
  }
  return whatsappPhoneNumberIdFromBusiness(null);
}
