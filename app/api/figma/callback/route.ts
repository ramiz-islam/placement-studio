/**
 * Figma sends the user back here with a code. Check the state, swap the code
 * for tokens, learn who they are, seal it all into the session cookie, and land
 * them back in the studio.
 *
 * Errors go back to the app as a query parameter rather than a bare error page,
 * so the studio can show them in its own toast.
 */

import { NextResponse } from "next/server";
import {
  COOKIE,
  SESSION_MAX_AGE,
  STATE_COOKIE,
  clearCookieHeader,
  cookieHeader,
  exchangeCode,
  figmaEnv,
  figmaGet,
  getCookie,
  originOf,
  seal,
  type FigmaSession,
} from "@/lib/figma-session";

export const runtime = "nodejs";

interface Me {
  handle: string;
  email?: string;
  img_url?: string;
}

export async function GET(req: Request) {
  const origin = originOf(req);
  const back = (q: string) => NextResponse.redirect(`${origin}/?${q}`, 302);
  const { cookieSecret } = figmaEnv();
  const u = new URL(req.url);

  const denied = u.searchParams.get("error");
  if (denied) return back(`figma=denied`);

  const code = u.searchParams.get("code");
  const state = u.searchParams.get("state");
  const expected = getCookie(req, STATE_COOKIE);
  if (!code || !state || !expected || state !== expected || !cookieSecret) {
    return back(`figma=error&why=${encodeURIComponent("The sign-in did not come back the way it left. Try again.")}`);
  }

  try {
    let sess: FigmaSession = await exchangeCode(code, `${origin}/api/figma/callback`);
    try {
      const me = await figmaGet<Me>(sess, "/v1/me");
      sess = { ...me.sess, user: { handle: me.data.handle, email: me.data.email, img: me.data.img_url } };
    } catch {
      // knowing the handle is a nicety; the connection still works without it
    }
    const res = back("figma=connected");
    res.headers.append("set-cookie", cookieHeader(req, COOKIE, await seal(sess, cookieSecret), SESSION_MAX_AGE));
    res.headers.append("set-cookie", clearCookieHeader(req, STATE_COOKIE));
    return res;
  } catch (e) {
    const why = e instanceof Error ? e.message : "Figma did not complete the connection.";
    return back(`figma=error&why=${encodeURIComponent(why)}`);
  }
}
