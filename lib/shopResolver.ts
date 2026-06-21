import type { SupabaseClient } from "@supabase/supabase-js";

type UserLike = {
  id: string;
  email?: string | null;
};

export async function resolveShopIdForUser(
  supabase: SupabaseClient,
  user: UserLike,
): Promise<string | null> {
  const userId = user.id;

  // Primary tenant model: one business record per auth user.
  // This is the preferred multi-tenant mapping.
  try {
    const { data, error } = await supabase
      .from("businesses")
      .select("id")
      .eq("owner_user_id", userId)
      .maybeSingle();

    if (!error && data?.id) return data.id;
  } catch {
    // ignore and continue with compatibility fallbacks
  }

  // Current schema sample shows `shops` does not include email/password (or any obvious owner columns).
  // So we resolve the shop using Supabase RLS:
  //   1) Try direct match: `shops.id === auth.user.id` (common pattern).
  //   2) Otherwise, fetch the first shop row the logged-in user can access.
  try {
    const { data, error } = await supabase
      .from("shops")
      .select("id")
      .eq("id", userId)
      .maybeSingle();

    if (!error && data?.id) return data.id;
  } catch {
    // ignore (mapping columns may differ / RLS may block)
  }

  try {
    const { data, error } = await supabase
      .from("shops")
      .select("id")
      .limit(1);

    if (!error && Array.isArray(data) && data[0]?.id) return data[0].id;
  } catch {
    // ignore
  }

  return null;
}

