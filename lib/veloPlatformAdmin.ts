/**
 * Comma- or whitespace-separated emails that may receive a Velo platform admin
 * session after signing in with Supabase on /login.
 *
 * Env: VELO_PLATFORM_ADMIN_EMAILS
 */
export function parsePlatformAdminEmails(): Set<string> {
  const raw = process.env.VELO_PLATFORM_ADMIN_EMAILS?.trim() ?? "";
  const set = new Set<string>();
  for (const part of raw.split(/[\s,;]+/)) {
    const e = part.trim().toLowerCase();
    if (e) set.add(e);
  }
  return set;
}

export function isPlatformAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return parsePlatformAdminEmails().has(normalized);
}

/** Avoid open redirects: only in-app Velo admin paths. */
export function safeVeloAdminNext(next: string | null | undefined): string {
  if (!next || typeof next !== "string") return "/velo-admin/analytics";
  const t = next.trim();
  if (!t.startsWith("/velo-admin/")) return "/velo-admin/analytics";
  if (t.includes("//") || t.includes("..") || t.includes("?")) return "/velo-admin/analytics";
  return t;
}
