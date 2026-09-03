/** Forget this browser's Figma connection. The token dies with the cookie. */

import { NextResponse } from "next/server";
import { COOKIE, clearCookieHeader } from "@/lib/figma-session";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const res = NextResponse.json({ ok: true });
  res.headers.append("set-cookie", clearCookieHeader(req, COOKIE));
  return res;
}
