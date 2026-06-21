import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isPlatformAdminEmail } from "@/lib/veloPlatformAdmin";
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
 * After Supabase password login, call with the access token to receive a
 * HttpOnly Velo admin API cookie when the user's email is in VELO_PLATFORM_ADMIN_EMAILS.
 *
 * Body: { access_token?: string } or header Authorization: Bearer <access_token>
 */
export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anon) {
    return NextResponse.json({ error: "Supabase is not configured on the server." }, { status: 503 });
  }

  let accessToken: string | undefined;
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    accessToken = authHeader.slice(7).trim();
  }
  if (!accessToken) {
    try {
      const body = (await req.json()) as { access_token?: string };
      accessToken =
        typeof body.access_token === "string" ? body.access_token.trim() : undefined;
    } catch {
      // ignore
    }
  }

  if (!accessToken) {
    return NextResponse.json({ error: "access_token required" }, { status: 400 });
  }

  const supabase = createClient(url, anon);
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) {
    return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });
  }

  const email = data.user.email;
  if (!isPlatformAdminEmail(email)) {
    return NextResponse.json({ ok: true, admin: false });
  }

  const token = createVeloAdminSessionToken();
  if (!token) {
    return NextResponse.json(
      {
        error:
          "VELO_ADMIN_SESSION_SECRET or PLATFORM_ADMIN_SECRET must be set to sign platform admin sessions.",
      },
      { status: 503 },
    );
  }

  const res = NextResponse.json({ ok: true, admin: true });
  res.headers.append("Set-Cookie", veloAdminCookieHeader(token, isSecure(req)));
  return res;
}
