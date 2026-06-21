import { NextRequest, NextResponse } from "next/server";
import {
  createVeloAdminSessionToken,
  veloAdminCookieHeader,
} from "@/lib/veloAdminSession";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isSecure(req: NextRequest): boolean {
  if (process.env.NODE_ENV === "production") return true;
  const proto = req.headers.get("x-forwarded-proto");
  return proto === "https";
}

/**
 * Legacy password-only platform login (optional). Prefer signing in at /login with a
 * Supabase user whose email is listed in VELO_PLATFORM_ADMIN_EMAILS.
 *
 * Body: { "password": "..." }
 *
 * Env: VELO_ADMIN_PASSWORD (required for this route), VELO_ADMIN_SESSION_SECRET or PLATFORM_ADMIN_SECRET (for cookie signing)
 */
export async function POST(req: NextRequest) {
  const expected = process.env.VELO_ADMIN_PASSWORD?.trim();
  if (!expected) {
    return NextResponse.json(
      {
        error:
          "VELO_ADMIN_PASSWORD is not set. Add it to your server environment to enable the Velo admin console.",
      },
      { status: 503 },
    );
  }

  let body: { password?: string };
  try {
    body = (await req.json()) as { password?: string };
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const password = typeof body.password === "string" ? body.password : "";
  if (!password || password !== expected) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const token = createVeloAdminSessionToken();
  if (!token) {
    return NextResponse.json(
      {
        error:
          "VELO_ADMIN_SESSION_SECRET or PLATFORM_ADMIN_SECRET must be set to sign admin sessions.",
      },
      { status: 503 },
    );
  }

  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", veloAdminCookieHeader(token, isSecure(req)));
  return res;
}
