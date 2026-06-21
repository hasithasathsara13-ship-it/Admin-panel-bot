import { createHmac, timingSafeEqual } from "crypto";

export const VELO_ADMIN_COOKIE = "velo_admin_session";

/** Cookie Path so the token is only sent to platform admin APIs. */
export const VELO_ADMIN_COOKIE_PATH = "/api/velo-admin";

function sessionSecret(): string | null {
  const s =
    process.env.VELO_ADMIN_SESSION_SECRET?.trim() ||
    process.env.PLATFORM_ADMIN_SECRET?.trim();
  return s || null;
}

export function createVeloAdminSessionToken(): string | null {
  const secret = sessionSecret();
  if (!secret) return null;

  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7; // 7 days
  const payload = Buffer.from(JSON.stringify({ exp, v: 1 }), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyVeloAdminSessionToken(token: string | undefined | null): boolean {
  if (!token || !token.includes(".")) return false;
  const secret = sessionSecret();
  if (!secret) return false;

  const dot = token.indexOf(".");
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!payload || !sig) return false;

  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  try {
    const a = Buffer.from(sig, "base64url");
    const b = Buffer.from(expected, "base64url");
    if (a.length !== b.length) return false;
    if (!timingSafeEqual(a, b)) return false;
  } catch {
    return false;
  }

  let parsed: { exp?: number };
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: number };
  } catch {
    return false;
  }

  if (typeof parsed.exp !== "number") return false;
  if (parsed.exp < Math.floor(Date.now() / 1000)) return false;
  return true;
}

export function veloAdminCookieHeader(token: string, secure: boolean): string {
  const parts = [
    `${VELO_ADMIN_COOKIE}=${encodeURIComponent(token)}`,
    `Path=${VELO_ADMIN_COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=604800",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function veloAdminClearCookieHeader(secure: boolean): string {
  const parts = [
    `${VELO_ADMIN_COOKIE}=`,
    `Path=${VELO_ADMIN_COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
