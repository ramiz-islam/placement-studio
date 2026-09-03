/**
 * Figma OAuth sessions — server only.
 *
 * Each user connects their own Figma account and imports run as them, so they
 * see exactly what they see in Figma and nothing more. The tokens live in a
 * sealed cookie: AES-GCM under a key derived from FIGMA_COOKIE_SECRET, HttpOnly,
 * so the browser carries them but cannot read them and the server keeps no
 * table of them. When real user accounts arrive, the same session object moves
 * to server-side storage keyed by the user — nothing else here changes.
 *
 * WebCrypto is used throughout because this runs on Cloudflare Workers as well
 * as Node, and both have `crypto.subtle`.
 */

export interface FigmaUser {
  handle: string;
  email?: string;
  img?: string;
}

export interface FigmaSession {
  access: string;
  refresh: string;
  /** ms since epoch when `access` expires */
  exp: number;
  user?: FigmaUser;
}

export const COOKIE = "ps_figma";
export const STATE_COOKIE = "ps_figma_state";
/** 90 days — Figma refresh tokens live long enough for that */
export const SESSION_MAX_AGE = 90 * 24 * 3600;

const FIGMA_TOKEN = "https://api.figma.com/v1/oauth/token";
const FIGMA_REFRESH = "https://api.figma.com/v1/oauth/refresh";
export const FIGMA_API = "https://api.figma.com";

/** PS_ prefixed vars win, so a stale ambient value cannot shadow .env.local. */
export function figmaEnv() {
  return {
    clientId: process.env.PS_FIGMA_CLIENT_ID || process.env.FIGMA_CLIENT_ID || null,
    clientSecret: process.env.PS_FIGMA_CLIENT_SECRET || process.env.FIGMA_CLIENT_SECRET || null,
    cookieSecret: process.env.PS_FIGMA_COOKIE_SECRET || process.env.FIGMA_COOKIE_SECRET || null,
  };
}

/* ---------------- sealing ---------------- */

const enc = new TextEncoder();
const dec = new TextDecoder();

const b64url = {
  encode(bytes: Uint8Array): string {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(str: string): Uint8Array {
    const s = str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (str.length % 4)) % 4);
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};

async function keyFor(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function seal(value: unknown, secret: string): Promise<string> {
  const key = await keyFor(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(value))));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return b64url.encode(out);
}

export async function open<T>(token: string, secret: string): Promise<T | null> {
  try {
    const bytes = b64url.decode(token);
    const key = await keyFor(secret);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12));
    return JSON.parse(dec.decode(pt)) as T;
  } catch {
    return null;
  }
}

/* ---------------- cookies ---------------- */

export function getCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/** The public origin, honouring the proxy headers Cloudflare and Vercel set. */
export function originOf(req: Request): string {
  const u = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? u.host;
  return `${proto}://${host}`;
}

export function cookieHeader(req: Request, name: string, value: string, maxAgeSec: number): string {
  const secure = originOf(req).startsWith("https") ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax${secure}`;
}

export function clearCookieHeader(req: Request, name: string): string {
  return cookieHeader(req, name, "", 0);
}

/* ---------------- session + API ---------------- */

export async function readSession(req: Request): Promise<FigmaSession | null> {
  const { cookieSecret } = figmaEnv();
  const raw = getCookie(req, COOKIE);
  if (!raw || !cookieSecret) return null;
  const s = await open<FigmaSession>(raw, cookieSecret);
  return s && s.access && s.refresh ? s : null;
}

function basicAuth(): string {
  const { clientId, clientSecret } = figmaEnv();
  return "Basic " + btoa(`${clientId}:${clientSecret}`);
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  user_id?: string;
}

/** Exchange the authorisation code Figma sent back for tokens. */
export async function exchangeCode(code: string, redirectUri: string): Promise<FigmaSession> {
  const body = new URLSearchParams({ redirect_uri: redirectUri, code, grant_type: "authorization_code" });
  const res = await fetch(FIGMA_TOKEN, {
    method: "POST",
    headers: { Authorization: basicAuth(), "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Figma refused the code (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const t = (await res.json()) as TokenResponse;
  return { access: t.access_token, refresh: t.refresh_token ?? "", exp: Date.now() + t.expires_in * 1000 };
}

/**
 * Renew the access token if it is within a minute of expiring. Returns the
 * session to store; the caller writes it back to the cookie when it changed.
 */
export async function refreshIfNeeded(s: FigmaSession): Promise<FigmaSession> {
  if (s.exp - Date.now() > 60_000) return s;
  const body = new URLSearchParams({ refresh_token: s.refresh });
  const res = await fetch(FIGMA_REFRESH, {
    method: "POST",
    headers: { Authorization: basicAuth(), "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error("Your Figma connection has expired — connect again.");
  const t = (await res.json()) as TokenResponse;
  return { ...s, access: t.access_token, refresh: t.refresh_token || s.refresh, exp: Date.now() + t.expires_in * 1000 };
}

/** GET from the Figma API as this user, refreshing first if the token is stale. */
export async function figmaGet<T>(s: FigmaSession, path: string): Promise<{ data: T; sess: FigmaSession }> {
  const sess = await refreshIfNeeded(s);
  const res = await fetch(`${FIGMA_API}${path}`, { headers: { Authorization: `Bearer ${sess.access}` } });
  if (res.ok) return { data: (await res.json()) as T, sess };

  // Figma explains itself in the body. Surface that verbatim: a 403 can mean
  // "you cannot see this file", "the token lacks this scope" or "this app is
  // not allowed to", and collapsing them into one sentence hid which it was.
  let reason = "";
  try {
    const body = (await res.json()) as { err?: string; message?: string; error?: string };
    reason = body.err || body.message || body.error || "";
  } catch {
    /* no JSON body */
  }
  const where = path.replace(/\?.*$/, "");
  const said = reason ? ` Figma said: "${reason}"` : "";
  if (res.status === 401) throw new Error(`Figma no longer accepts this connection — connect again.${said}`);
  if (res.status === 403) throw new Error(`Figma refused ${where} (403).${said}`);
  if (res.status === 404) throw new Error(`Figma could not find that file or frame (404 on ${where}).${said}`);
  if (res.status === 429) throw new Error("Figma is rate-limiting requests. Try again in a minute.");
  throw new Error(`Figma returned ${res.status} on ${where}.${said}`);
}
