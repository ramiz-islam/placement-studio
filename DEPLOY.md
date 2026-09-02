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

### Why a green `git push` does not update the live site

`git push` only reaches GitHub. Nothing was watching GitHub, so the Worker stayed on whatever
`npm run cf:deploy` last put there, and `Everything up-to-date` said nothing at all about the live URL.
Two ways to close that gap — pick one.

**Either: GitHub Actions (in the repo, `.github/workflows/deploy.yml`).** Already committed. Add two repository
secrets and every push to `main` deploys:

**GitHub → Settings → Secrets and variables → Actions → New repository secret**

| Name | Where to get it |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → Create Token → use the **Edit Cloudflare Workers** template |
| `CLOUDFLARE_ACCOUNT_ID` | the hex id in any Workers dashboard URL, `dash.cloudflare.com/<account id>/workers` |

Until those exist the workflow will run and fail on the deploy step, which is a louder and more useful signal than
silently drifting. Worker secrets and the R2 binding are untouched by it.

**Or: Cloudflare's own build integration** (below). Same outcome, configured in the dashboard instead of the repo.
Do not enable both, or one push deploys twice.

### Connecting it to GitHub for automatic deploys (the Cloudflare side)

Optional if you use the Actions workflow above. `npm run cf:deploy` also still ships from your machine.

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

## Changing the URL

`placement-studio.ramiz-b05.workers.dev` is two separate things joined by a dot: the **Worker name** and your
account's **workers.dev subdomain**.

**A custom domain — the one worth doing.** Any domain already on Cloudflare DNS can point straight at the Worker:

**Workers & Pages → `placement-studio` → Settings → Domains & Routes → Add → Custom domain**

Enter something like `studio.carswitch.com`. Cloudflare creates the DNS record and the certificate. The
`workers.dev` URL keeps working alongside it, and can then be switched off on the same screen.

**Renaming the Worker** changes the first half. Edit `name` in `wrangler.jsonc` and deploy — but understand what
that does: Cloudflare has no rename. A new name is a **new Worker**, so it starts with no secrets and no R2 binding,
the R2 binding returns from `wrangler.jsonc` but the three secrets must be set again with `npx wrangler secret put`,
and the old Worker keeps running at the old URL until you delete it. Fine to do; just not a one-field change.

**Changing the `ramiz-b05` half** is an account-level setting and renames the URL of every Worker on the account
at once. Rarely what you want.

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
