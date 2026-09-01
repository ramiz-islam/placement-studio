# Placement Studio

Upload or generate an ad creative, see it sitting inside every channel's real feed chrome, check it against each placement's published safe zone, then export the statics.

Built for CarSwitch's KSA and UAE feeds. 23 placements across 9 channels.

---

## Setup

```bash
npm install
cp .env.local.example .env.local
```

Put two keys in `.env.local`:

| Key | Used for | Required |
|---|---|---|
| `OPENAI_API_KEY` | image generation (`gpt-image-1`) | for the Picture tab |
| `ANTHROPIC_API_KEY` | headlines, CTAs, Najdi and Khaleeji register | for the Words tab |

The preview, safe-zone checks, drag-and-drop layout and export all work with **no keys at all** — only generation needs them.

```bash
npm run dev
```

Then open http://localhost:3210.

---

## What it does

### Phase 1 — preview and safe zones

- **23 placements, 9 channels** — Snapchat (single, collection, commercial), TikTok (in-feed, spark), Instagram (reels, stories, feed 4:5), Facebook (reels, stories, feed 4:5), YouTube Shorts, Google (Demand Gen 4:5 and 1.91:1, Display 1:1, App Campaign), Pinterest (standard pin, idea pin), X (1.91:1, 1:1), LinkedIn (1.91:1, 1:1, 4:5).
- **Reserved bands drawn over the creative**, measured in real pixels against each placement's own canvas.
- **Collision detection.** The creative is composed into each placement exactly as the feed would crop it, then scored cell by cell for local edge energy. Cells that are unusually detailed *relative to the rest of the frame* get flagged where they land in a reserved band. This measures detail density, not glyphs — the UI says so everywhere.
- **Draggable layers** — positions are per placement, so a drag on TikTok never moves Snapchat. Live pixel readout, per-layer intrusion checks, and explicit ways to push a layout everywhere.
- **Crop or letterbox per channel**, with a shared default — a 2:3 source can be cropped on Reels and letterboxed on a 1.91:1 banner in the same session.
- **Undo and redo**, 30 steps, Ctrl+Z / Ctrl+Shift+Z. A slider drag collapses into a single step rather than one per pixel.
- **Layers**: unlimited text (each with its own font, size, colours, tracking, case and scrim), buttons, logo, shapes (rectangle, ellipse, triangle, band, line — flat fill, gradient, or an uploaded image clipped to the shape) and icons (12 built-in, or upload). Add, rename, hide, duplicate, reorder, delete.
- **Second text colour by tapping words** — no markup to learn; the bracket syntax is just the storage format.
- **Scrims** on text, logo and icon layers, plus a full-width band that moves with the logo. Every fill can be a gradient.
- **Master safe zone** — the intersection of every reserved band across a ratio group. For 9:16 that is **876 × 970**, with Snapchat Collection Ad setting the floor at 700px of bottom furniture.
- **Audit and score per placement** — ratio and crop loss, resolution, file size, band collisions, focal point, per-layer overlap, WCAG contrast measured against the real pixels underneath, RTL-versus-icon-rail conflicts, and platform re-crop exposure.
- **Export** at native placement resolution (0.5× to 3×), PNG / JPEG / WebP, with a per-placement quality search that lands each file just under that platform's size cap, an upscale warning when the source has to stretch, a file-size badge per image, and an optional safe-zone-guide burn-in for briefs.
- **Brand kit** asked once, saved to `localStorage`, applied to every creative after that.

### Phase 2 — generation

**Picture** (OpenAI `gpt-image-1`)

Seven creative types — UGC, product hero, lifestyle, infographic, social post, ad remake, seasonal drop — each with its own art-direction spine. Choose target shape, market, variations and quality.

Two decisions worth knowing about:

1. **Images are generated without text by default.** Baked-in text cannot be repositioned per placement, cannot be translated, and cannot be checked against a safe zone. The studio's own copy layers do all three. There is a toggle if you want the model to letter the image anyway, and it warns you.
2. **The prompt carries the safe zone.** Before calling the model, the builder reads the placement table and tells it which bands to keep visually simple — e.g. *"keep the bottom 36% simple, Snapchat Collection Ad has the deepest furniture."* This is the reason generation lives inside the preview tool rather than beside it.

**Ad remake** posts the loaded creative as a reference and uses the images *edit* endpoint, so the rebuild keeps the original's composition and can be A/B tested against it.

Every generation is saved automatically with the exact prompt that made it and appears in **Library** — reload any of them onto the stage, read the prompt back, or delete it. Storage picks itself: `.data/generated` on disk locally, Vercel Blob in production (see DEPLOY.md).

**Words** (Claude)

Headlines and CTAs written to register: Najdi for KSA, Khaleeji for the UAE, MSA only for formal contexts. Copy runs on Claude rather than the image provider because register is the whole job — the brand book forbids machine translation and requires KSA-facing short copy to be Najdi, not generic Gulf.

Arabic output is labelled a draft in the UI. It is written to register, not translated word for word, but a native speaker still signs it off before it runs.

---

## Layout

```
app/
  page.tsx              app shell, sheets, keyboard handling
  globals.css           the whole design system (CarSwitch palette, single dark world)
  api/generate/route.ts OpenAI images — generate and edit
  api/copy/route.ts     Claude — headlines, CTAs, Arabic register
  api/library/route.ts  local generation library
lib/
  core.ts               placement table, fonts, swatches, creative types  ← edit specs here
  geometry.ts           layer boxes, safe zones, master zone, wrapping
  analysis.ts           edge-energy detail map, collision, focal point
  audit.ts              the per-placement checks and score
  render.ts             canvas exporter at native resolution
  prompt.ts             brand voice + both prompt builders
  layers.ts             the layer model, icon paths, factories  ← add a layer kind here
  library.ts            generation store — R2 on Cloudflare, Vercel Blob, or fs locally
middleware.ts           password gate for deployed instances
components/
  StudioProvider.tsx    one state object, one patch function
  Device.tsx            a placement frame: media, chrome, layers, bands, drag
  Chrome.tsx            the platform UI mocks (cqw-scaled)
  Stage.tsx             chips, focus view, grid view, synthetic samples
  LeftRail.tsx          creative, frame defaults, language
  LayersPanel.tsx       the layer list and the per-layer inspector
  AuditPanel.tsx        score, checks, master zone, spec sheet, best practice
  ExportSheet.tsx       placement picker, resolution, quality search, save/copy
  LibrarySheet.tsx      every generation, its prompt, reload and delete
  GenerateSheet.tsx     Phase 2 — Picture and Words
  BrandKitSheet.tsx     the once-only kit
```

`lib/geometry.ts` is the single source of truth for layout maths, shared by the DOM preview and the canvas exporter. That is what makes "what you drag is what you download" true rather than aspirational.

---

## Maintaining the placement table

Everything about a placement lives in one object in `lib/core.ts`: canvas size, reserved pixels, whether it has a right-hand icon rail, max file size, the spec sheet, and its best-practice notes. Adding a channel is one entry plus a `chrome` case in `components/Chrome.tsx`.

The safe-zone numbers are published ad-spec values. Platforms revise their UI silently. If you want them airtight, screenshot three or four live ads per placement and measure — then the numbers are yours and defensible.

---

## Notes

- `next dev` runs on port 3210 to stay clear of the SEO platform.
- `.data/` and `.env.local` are gitignored. Nothing here writes to `public/`.
- The exporter uses the browser's canvas, so export needs no server and no keys.
- Deployment is documented in [DEPLOY.md](DEPLOY.md) — GitHub + Cloudflare Workers (verified on the real runtime), or Vercel from the same codebase. A deployed instance refuses every request unless `SITE_PASSWORD` is set — this app holds API keys and spends money per generation, so it must not be publicly reachable.
- Never run `next build` while `next dev` is live: the production output overwrites `.next` and the dev server 500s until you delete `.next` and restart.
