# Taking it live

Everything is deploy-ready. The three things that were missing — a password gate, storage that survives a read-only filesystem, and request bodies that fit inside a serverless limit — are done. What remains needs your Vercel account, which I can't log into.

---

## Read this first

This app **spends money on every generation** and holds two API keys server-side. On a public URL with no lock, anyone who finds it can burn your OpenAI budget.

So the deployment refuses to serve anything unless `SITE_PASSWORD` is set. That's deliberate — a misconfigured deploy fails loudly instead of sitting open. You'll get a browser password prompt: leave the username blank, type the password.

---

## Deploy

```bash
cd C:\Users\seora\placement-studio
npx vercel login
```

Then link and push a preview build:

```bash
npx vercel
```

Answer the prompts: set up a new project, keep the detected Next.js settings, accept the defaults. It gives you a preview URL.

Now add the environment variables. Either in the Vercel dashboard under **Settings → Environment Variables**, or from the terminal:

```bash
npx vercel env add SITE_PASSWORD production
npx vercel env add OPENAI_API_KEY production
npx vercel env add ANTHROPIC_API_KEY production
```

Add Blob storage so the generation library persists — **Storage → Create → Blob**, then connect it to this project. Vercel injects `BLOB_READ_WRITE_TOKEN` automatically and the app switches drivers with no code change. Without it, generation still works but nothing is saved to the library.

Ship it:

```bash
npm run deploy
```

Redeploy after changing any environment variable — they're baked in at build time.

---

## What to check once it's up

1. The password prompt appears. If you instead see *"SITE_PASSWORD is not set on this deployment"*, add the variable and redeploy.
2. Generate one image. Then open **Library** — it should be there, and the footer should say **Vercel Blob** rather than `.data/generated`.
3. Export one placement with **Fit under platform limit** on and check the file size badge.

---

## Plan limits worth knowing

| Limit | Hobby | Effect here |
|---|---|---|
| Function duration | 60s | `maxDuration` is set to 60. High-quality gpt-image takes 20–60s **per image**, so asking for 3–4 at once can time out. Generate 1–2 at a time, or raise `maxDuration` to 300 in `app/api/generate/route.ts` on Pro. |
| Request body | ~4.5 MB | Ad remake downscales the reference to 1024px before posting, so this is handled. |
| Filesystem | read-only | Why Blob storage matters. Without it `saveGeneration` logs a failure and returns the image anyway. |

Everything else — preview, safe zones, drag, audit, export — runs entirely in the browser and costs nothing to serve.

---

## If you'd rather not put it on the internet

It works fine as a local tool: `npm run dev` and nothing leaves your machine. That's the lowest-risk option while it's only you using it, and the only real cost of staying local is that teammates can't open it.

A middle option is a Vercel preview deployment kept unlisted and password-protected, which is what the steps above produce before you run `npm run deploy`.
