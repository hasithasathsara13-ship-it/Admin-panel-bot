import type { SupabaseClient } from "@supabase/supabase-js";

function asRecord(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}

export async function ensureBusinessForUser(
  supabase: SupabaseClient,
  user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> | null },
): Promise<string | null> {
  const userId = user.id;
  const userEmail = user.email ?? null;
  const meta = asRecord(user.user_metadata);
  const businessNameRaw = meta.business_name;
  const businessName =
    typeof businessNameRaw === "string" && businessNameRaw.trim()
      ? businessNameRaw.trim()
      : userEmail?.split("@")[0] ?? "Business";

  const existing = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_user_id", userId)
    .maybeSingle();
  if (!existing.error && existing.data?.id) return existing.data.id;

  const inserted = await supabase
    .from("businesses")
    .insert({
      owner_user_id: userId,
      support_email: userEmail,
      business_name: businessName,
    })
    .select("id")
    .single();

  if (inserted.error) return null;
  return inserted.data?.id ?? null;
}
