/**
 * Is this browser connected to Figma, and as whom?
 *
 * Also the place a stale access token gets quietly renewed: if the refresh
 * changed the session, the new cookie rides back on the response.
 */

import { NextResponse } from "next/server";
import {
  COOKIE,
  SESSION_MAX_AGE,
  clearCookieHeader,
  cookieHeader,
  figmaEnv,
  readSession,
  refreshIfNeeded,
  seal,
} from "@/lib/figma-session";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { clientId, clientSecret, cookieSecret } = figmaEnv();
  const configured = Boolean(clientId && clientSecret && cookieSecret);
  const sess = await readSession(req);
  if (!sess) return NextResponse.json({ configured, connected: false });

  try {
    const fresh = await refreshIfNeeded(sess);
    const res = NextResponse.json({ configured, connected: true, user: fresh.user ?? null });
    if (fresh !== sess && cookieSecret) {
      res.headers.append("set-cookie", cookieHeader(req, COOKIE, await seal(fresh, cookieSecret), SESSION_MAX_AGE));
    }
    return res;
  } catch {
    // the refresh token is dead: drop the cookie so the UI offers to connect again
    const res = NextResponse.json({ configured, connected: false, expired: true });
    res.headers.append("set-cookie", clearCookieHeader(req, COOKIE));
    return res;
  }
}
