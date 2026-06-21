import { NextRequest } from "next/server";
import { VELO_ADMIN_COOKIE, verifyVeloAdminSessionToken } from "@/lib/veloAdminSession";

export function getVeloAdminToken(req: NextRequest): string | undefined {
  return req.cookies.get(VELO_ADMIN_COOKIE)?.value;
}

export function requireVeloAdmin(req: NextRequest): boolean {
  return verifyVeloAdminSessionToken(getVeloAdminToken(req));
}
