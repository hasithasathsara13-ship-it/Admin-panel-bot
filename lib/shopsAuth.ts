import type { SupabaseClient } from "@supabase/supabase-js";

type LoginResult =
  | { ok: true; shopId: string; shopEmail?: string | null }
  | { ok: false; error: string };

function pickFirstString(obj: Record<string, unknown>, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

export async function validateShopLogin(
  supabase: SupabaseClient,
  params: { email: string; password: string },
): Promise<LoginResult> {
  const email = params.email.trim();
  const password = params.password;

  if (!email || !password) {
    return { ok: false, error: "Email and password are required." };
  }

  const emailColumnCandidates = [
    "email",
    "shop_email",
    "owner_email",
    "business_email",
    "user_email",
  ];

  // We select "*" to be resilient to different `shops` schemas/column names.
  // Then we match known field keys heuristically.
  for (const column of emailColumnCandidates) {
    try {
      const { data, error } = await supabase
        .from("shops")
        .select("*")
        .eq(column, email)
        .limit(5);

      if (error) continue;

      const rows = Array.isArray(data) ? data : [];
      for (const row of rows) {
        const r = row as unknown as Record<string, unknown>;

        const shopEmail =
          pickFirstString(r, ["email", "shop_email", "owner_email", "business_email"]) ??
          null;

        const storedPassword =
          pickFirstString(r, [
            "password",
            "pass",
            "shop_password",
            "auth_password",
            "secret",
          ]) ?? null;

        if (!shopEmail || !storedPassword) continue;

        // NOTE: This is plain-text comparison because there is no backend auth mechanism here.
        if (
          storedPassword === password &&
          shopEmail.toLowerCase() === email.toLowerCase()
        ) {
          const shopId = pickFirstString(r, ["id", "shop_id"]);
          if (!shopId) {
            return { ok: false, error: "Shop id not found for this user." };
          }
          return { ok: true, shopId, shopEmail };
        }
      }
    } catch {
      // Column probably doesn't exist or RLS denied access; try the next mapping.
    }
  }

  return { ok: false, error: "Invalid login credentials." };
}

