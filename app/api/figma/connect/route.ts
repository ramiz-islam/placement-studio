/**
 * Start the Figma OAuth dance: send the user to Figma to approve access.
 *
 * `state` is a random value written into a short-lived cookie and checked on
 * the way back, so a forged callback cannot attach someone else's Figma account
 * to this browser.
 */

import { NextResponse } from "next/server";
import { STATE_COOKIE, cookieHeader, figmaEnv, originOf } from "@/lib/figma-session";

export const runtime = "nodejs";

/**
 * Read-only access to file content, plus who the user is so the UI can say so.
 *
 * These must also be ticked on the app's "OAuth scopes" page in Figma, or the
 * authorise step answers "Invalid scopes for app" before the user ever sees a
 * consent screen. FIGMA_SCOPES overrides the list so a mismatch can be fixed
 * with a secret rather than a deploy. Space-separated, which Figma accepts
 * alongside commas.
 *
 * Not exported: Next.js type-checks route modules and rejects any export that
 * is not a handler or a route config.
 */
const SCOPES = process.env.PS_FIGMA_SCOPES || process.env.FIGMA_SCOPES || "file_content:read current_user:read";

export async function GET(req: Request) {
  const { clientId, clientSecret, cookieSecret } = figmaEnv();
  if (!clientId || !clientSecret || !cookieSecret) {
    return NextResponse.json(
      {
        error:
          "Figma is not set up yet. Register an app at figma.com/developers/apps and add FIGMA_CLIENT_ID, FIGMA_CLIENT_SECRET and FIGMA_COOKIE_SECRET.",
      },
      { status: 503 }
    );
  }

  const state = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("");
  const redirectUri = `${originOf(req)}/api/figma/callback`;
  const url = new URL("https://www.figma.com/oauth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");

  const res = NextResponse.redirect(url.toString(), 302);
  res.headers.append("set-cookie", cookieHeader(req, STATE_COOKIE, state, 600));
  return res;
}
