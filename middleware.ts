import { NextResponse, type NextRequest } from "next/server";

/**
 * Password gate for deployed instances.
 *
 * This app spends real money on every generation and holds two API keys. On a
 * public URL with no lock, anyone who finds it can burn the OpenAI budget, so
 * a deployment without SITE_PASSWORD set is refused outright rather than
 * quietly left open.
 *
 * Local development is unaffected: no SITE_PASSWORD and no VERCEL env means no
 * gate. HTTP Basic is deliberate — no login page, no session store, and the
 * browser remembers it.
 */

const encoder = new TextEncoder();

/** Constant-time-ish compare, so a wrong password does not leak its length. */
function sameSecret(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

const challenge = (body: string, status = 401) =>
  new NextResponse(body, {
    status,
    headers: {
      "WWW-Authenticate": 'Basic realm="Placement Studio", charset="UTF-8"',
      "content-type": "text/plain; charset=utf-8",
    },
  });

export function middleware(req: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  const deployed = Boolean(process.env.VERCEL) || process.env.NODE_ENV === "production";

  if (!password) {
    if (!deployed) return NextResponse.next(); // local dev, nothing to protect
    return challenge(
      "SITE_PASSWORD is not set on this deployment. Set it in the project's environment variables and redeploy — this app holds API keys and must not be publicly reachable.",
      503
    );
  }

  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const supplied = decoded.slice(decoded.indexOf(":") + 1);
      if (sameSecret(supplied, password)) return NextResponse.next();
    } catch {
      /* malformed header — fall through to the challenge */
    }
  }
  return challenge("Authentication required.");
}

export const config = {
  // everything except Next's static assets and the favicon
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
