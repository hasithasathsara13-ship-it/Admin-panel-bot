import { NextRequest, NextResponse } from "next/server";
import { veloAdminClearCookieHeader } from "@/lib/veloAdminSession";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isSecure(req: NextRequest): boolean {
  if (process.env.NODE_ENV === "production") return true;
  const proto = req.headers.get("x-forwarded-proto");
  return proto === "https";
}

export async function POST(_req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", veloAdminClearCookieHeader(isSecure(_req)));
  return res;
}
