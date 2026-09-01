# Taking it live — GitHub + Cloudflare

The app is Cloudflare-ready and **verified running on Cloudflare's actual runtime**, not just configured for it: the Worker builds, boots, enforces the password gate (401 without, 200 with), and reports `driver: "r2"` from `/api/library`.

What's left needs your GitHub and Cloudflare accounts, which I can't log into.

---

## Read this first

This app **spends money on every generation** and holds two API keys server-side. A deployment refuses to serve anything unless `SITE_PASSWORD` is set — a misconfigured deploy fails loudly instead of sitting open. You'll get a browser password prompt: leave the username blank, type the password.

Push the repo **private**. It contains no keys (`.env.local` and `.dev.vars` are gitignored), but it does contain CarSwitch brand configuration and the placement research.

---

## 1. GitHub

The repo already exists locally with full history on `main`. **Done.** The repo is at `https://github.com/ramiz-islam/placement-studio` and `main` tracks `origin/main`.

For reference, that was:

```
git remote add origin https://github.com/ramiz-islam/placement-studio.git
```

```
git push -u origin main
```

Note: PowerShell 5.1 has no `&&`, so run commands one at a time.

Verify nothing sensitive went up:

```
git ls-files | Select-String -Pattern "env|dev.vars"
```

That should return only `.env.local.example`.

---

## 2. Cloudflare

Log in and create the R2 bucket the generation library uses:

```
npx wrangler login
```

```
npx wrangler r2 bucket create placement-studio-generations
```

Now deploy once, which creates the Worker. Secrets cannot be set on a Worker that does not exist yet, so this comes
first:

```
npm run cf:deploy
```

Until `SITE_PASSWORD` is set the deployed URL answers **503 on every request** — that is the gate working, not a
failure. Set the three secrets now; each prompts for the value and none of them land in git:

```
npx wrangler secret put SITE_PASSWORD
```

```
npx wrangler secret put OPENAI_API_KEY
```

```
npx wrangler secret put ANTHROPIC_API_KEY
```

Each `secret put` redeploys the Worker with the new value, so no extra deploy is needed. Reload the URL and the
password prompt should appear.

To try it on the real Workers runtime locally before or after deploying:

```
npm run cf:preview
```

### Connecting it to GitHub for automatic deploys (optional)

Entirely optional — `npm run cf:deploy` already ships. This only makes pushes deploy themselves.

**Connect Git to the Worker that already exists.** Do not create a new project: the "Create" flow leads to Cloudflare
**Pages**, a different product that has no deploy-command field and no Workers bindings, and it would stand up a
second empty deployment at `*.pages.dev` with no R2 and no secrets.

Dashboard path:

**Workers & Pages → `placement-studio` → Settings → Builds → Connect**

Then in the prompts:

| Setting | Value |
|---|---|
| Repository | `ramiz-islam/placement-studio` |
| Production branch | `main` |
| Build command | `npm run cf:build` |
| Deploy command | `npx wrangler deploy` |
| Root directory | *(leave blank)* |

**Nothing needs re-entering.** Secrets live on the Worker, which is why redeploys have not needed them re-set, and the
R2 binding comes from `wrangler.jsonc` on every deploy. Connecting Git adds CI; it does not replace the Worker.

---

## What to check once it's up

1. The password prompt appears. If you instead see *"SITE_PASSWORD is not set on this deployment"*, add the secret and redeploy.
2. Generate one image, then open **Library** — the footer should say **Cloudflare R2**.
3. Export one placement with **Fit under platform limit** on and check the file-size badge.

---

## Platform notes

| Concern | How it's handled |
|---|---|
| No filesystem on Workers | The library has three storage drivers and picks itself: R2 when the `GENERATIONS` binding exists, Vercel Blob when `BLOB_READ_WRITE_TOKEN` does, otherwise `.data/generated` on disk for local dev. `node:fs` is imported dynamically so it never enters the Workers bundle. |
| Node APIs in the SDKs | `nodejs_compat` is set in `wrangler.jsonc`. Both the OpenAI and Anthropic SDKs are fetch-based and work under it. |
| CPU / duration limits | Image generation is a single outbound fetch, so the Worker is mostly idle while waiting. Requesting 3–4 high-quality images at once is still the slowest path — generate 1–2 at a time. |
| Request body size | Ad remake downscales the reference image to 1024px before posting, well under any platform's body limit. |
| Export | Runs entirely in the browser on canvas. It needs no server, no keys, and costs nothing to serve. |

---

## Vercel is still supported

`npm run deploy` deploys to Vercel unchanged, using the Blob driver instead of R2. Both hosts work from the same codebase; nothing is Cloudflare-only.

---

## If you'd rather not put it on the internet

It works fine as a local tool — `npm run dev`, nothing leaves your machine. That stays the lowest-risk option while it's only you using it; the only cost is that teammates can't open it.
