# Placement Studio — handoff (2026-09-15, HEAD c841bad)

Read this first in a new session. It is the state of the project, the decisions
already made, and the two problems that are open. Nothing here is aspirational;
everything under "What exists" is built, verified and deployed.

## Who and why

Owner: Ramiz (ramiz@carswitch.com), CarSwitch marketer, not an engineer. Explain
trade-offs in plain words; keep code readable. The users are Ramiz and one
in-house designer. The designer works in **Figma** (has a paid team account) and
Photoshop.

Purpose of the tool: take an ad creative, preview it inside every channel and
placement (Snapchat, TikTok, Instagram, Facebook, YouTube, Google, Pinterest, X,
LinkedIn — 23 placements) with the platform's safe zones, run a readiness audit
with a score (pass mark 70), edit the layers per placement, export upload-ready
files at native resolution.

## The open problem (why the last session ended)

The designer is not using it. His feedback, verbatim from Ramiz:

> "the major feedback is that this is not working well with figma. and he can
> not start the design from scratch on this tool because of its capabilities."

Two separate gaps:

1. **Figma round-trip is weak.** The importer works on test frames (verified
   with unit tests and an exported screenshot) but the designer's real frames
   exposed: ghosting (fixed: frame's own fill is now the background), rotated
   rectangles as bounding boxes (fixed: size + rotation), lost second text
   colour (fixed: characterStyleOverrides → [brackets]). Unknown: what else
   breaks on his files. Fonts, effects, auto-layout, components, masks, vectors,
   blend modes are NOT brought through as editable layers — anything that is not
   a rectangle, image or plain text arrives as a rendered PNG rectangle.
   We do not yet have his concrete list of failures. Get it before building.

2. **Cannot start a design from scratch.** The tool is a layout/placement
   editor, not a design canvas. There is no blank-canvas start, no templates,
   no pen/vector tools, limited shapes (rect, ellipse, band, line, triangle,
   chevron, strip), no font upload, no image editing beyond crop/letterbox and
   an AI cut-out. A designer opening it expects Figma-grade drawing and gets a
   form-filler for layers.

Strategic question to settle with Ramiz before coding: is the tool
(a) a **checker/adapter** that sits after Figma (design in Figma → import →
audit → per-placement fixes → export), in which case fix the Figma import
until it is faithful and stop pretending to be a canvas; or
(b) a **creation tool** that competes with Figma for the first draft, which
means templates, a blank start, brand-kit-driven layouts, fonts, and a much
richer shape/text engine. (a) is the realistic one for a two-person user base.
A hybrid worth proposing: a Figma plugin ("Send to Placement Studio") instead
of URL import, and export back to Figma (write frames) so the designer never
leaves Figma.

## What exists

Repo: `C:\Users\seora\placement-studio` (deliberately off Google Drive), branch
`main`. GitHub: `ramiz-islam/placement-studio` (personal account).
Live: https://placement-studio.ramiz-b05.workers.dev — HTTP Basic, username
blank, password only. Cloudflare account `b0533d8e6700f135f48d3bcfba683515`,
Worker `placement-studio`, R2 bucket `placement-studio-generations` bound as
`GENERATIONS`.

Deploy: `git push` to main → GitHub Action `.github/workflows/deploy.yml`
(typecheck → `opennextjs-cloudflare build && deploy`). Verified green. Manual
fallback: `npm run cf:deploy`. Dev: `npm run dev` on http://localhost:3210
(writes to `.next-dev`, so a production build never breaks the dev server).

Stack: Next.js 15 App Router, React 19, TypeScript strict, hand-written
`app/globals.css` (light theme, shadow scale `--sh-1..4`, text-safe inks
`--coral-ink/--amber-ink/--lime-ink`, all text styles WCAG AA).
`@opennextjs/cloudflare` for Workers.

Worker secrets (set, never printed): `SITE_PASSWORD`, `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `FIGMA_CLIENT_ID`, `FIGMA_CLIENT_SECRET`,
`FIGMA_COOKIE_SECRET`. `.env.local` mirrors them locally. Rule from Ramiz:
tokens are pasted only into GitHub/Cloudflare, never into chat or files.

### Architecture (lib/ is pure logic, components/ is UI)

- `lib/core.ts` — `Design {autoPlaced, importSource, fit, fitOverrides, lang,
  copyOn, layers, overrides}`, `BrandKit {…, logos: KitLogo[], appScreen}`,
  placement spec table, `hasRTLText`.
- `lib/layers.ts` — one ordered layer list; kinds `text | cta | logo | shape |
  icon | screen`; `rotation?`, `group?` on every layer; text has `grad`,
  `vertical`, `stroke`, `shadow`, `[bracketed]` second colour; shapes take an
  image (`src`, `srcFit`); `screen` = app screenshot pinned by 4 corners
  (`lib/perspective.ts` homography → CSS matrix3d and canvas `drawQuad`).
- `lib/geometry.ts` — `place()/placeAll()` is the single geometry source for
  the DOM preview and the canvas exporter. **Rule: geometry is per placement
  (overrides = `LayerPatch {pos,w,h,size,blockW,rotation,corners}` keyed
  placementId→layerId); style is global.** Ink box vs layout box, snapping
  (`snapLines/snapBox`, 6px, Shift bypasses), `importOverrides`,
  `ratioMismatch`, `coverRect`.
- `lib/audit.ts` — `PENALTIES` single source of truth, `PENALTY_ROWS`,
  `PASS_MARK = 70`, only logo/text/cta are scored, checks carry
  `layerId/key/penalty` so a click jumps to the layer; per-placement
  `ignored[placementId][key]` gives a second "adjusted" score. Resolution is
  judged by upscale factor, crop by lost detail.
- `lib/autolayout.ts` — content-aware placement (busyness + contrast cost,
  grid-scan for logo, auto plates).
- `lib/render.ts` — canvas exporter: rotation, stroke/shadow, gradient text,
  RTL token reversal per line, chevron path, screen quad.
- `lib/psd.ts` — ag-psd in the browser. Bottom consecutive covering rasters →
  creative; text size = fontSize × hypot(transform[2],[3]); groups, hidden
  propagation, blank rasters skipped, RTL right-anchored; `flatten` option
  uses Photoshop's composite. Layer effects and fonts do not come through.
- `lib/figma.ts` — `parseFigmaUrl`, `planFigmaImport` (background = covering
  child or frame's own fill via imageRef/solid; rects via `size`+`rotation`;
  two-tone text via `characterStyleOverrides`; everything else rendered PNG).
- `lib/figma-session.ts` — per-user OAuth. AES-GCM sealed HttpOnly cookie
  `ps_figma`, token refresh, verbose 403 reasons. Scopes
  `file_content:read current_user:read` (env `FIGMA_SCOPES`).
- `app/api/figma/{connect,callback,me,disconnect,import}/route.ts`,
  `app/api/cutout/route.ts` (gpt-image edit, transparent background, ~40 s),
  `/api/generate`, `/api/copy` (Claude), `/api/library` (r2/blob/fs drivers).
- `components/StudioProvider.tsx` — the store. `commit(tag, fn)` with undo/redo
  and same-tag coalescing; `applyImport` shared by PSD and Figma (letterboxes
  ratio mismatches, lands on the matching placement); `remapImports`;
  `plateLayers`; `cutOutSubject`; kit logo CRUD; `toggleIgnore`.
- `components/Device.tsx` (frame: drag, 8 resize handles, rotate any angle,
  corner pins, snapping guides, click-through), `CanvasToolbar.tsx`,
  `LayersPanel.tsx`, `Stage.tsx`, `AuditPanel.tsx`, `LeftRail.tsx` (Import
  PSD / flat), `FigmaPanel.tsx`, `BrandKitSheet.tsx`, `ExportSheet.tsx`.

### Figma OAuth state — action needed by Ramiz

- App registered on Ramiz's Figma account, scopes ticked, secrets on the
  Worker. Ramiz can connect and import.
- The app is still a **draft**, so only Ramiz can authorise it. The designer
  saw "OAuth app doesn't exist". Fix: Figma → the app → **Publish → Private**,
  then invite the designer to "Ramiz Islam's team" (free on Starter). Public
  needs Figma review. Long term: recreate the app under a CarSwitch team.
- Import needs the file shared with the connecting user by email (viewer).
  Link-only sharing returns 403 "Request denied" from the API. A link to a
  page (`node-id=0-1`) imports the first frame and says so.

### Known limits, stated to Ramiz

- Photoshop layer effects and original fonts cannot come through layered
  imports; the flat import is exact but not editable.
- Arabic type penalties may be miscalibrated; imported designs often score 0.
- Figma session is per browser until Cloudflare Access adds identity.
- Custom domain for the Worker not done (steps in DEPLOY.md).

### Test fixtures (local only, gitignored)

`public/_test.psd` (1200×628, real designer file), `public/_story.psd`
(1080×1920, "Story-03"), `public/_synth.psd`. Unit tests were ad-hoc Node
scripts in the session scratchpad (31 assertions for geometry/PSD/Figma); they
are not in the repo — worth adding a `tests/` folder.

## Working rules learned with Ramiz

- Verify in the browser and by exported pixels before claiming done; he checks.
- One PowerShell 5.1 command per line, no `&&`.
- Never run `next build` while dev is live without the `.next-dev` split.
- Don't invent UI direction silently: he rejected several UI passes; ask with
  concrete options when the change is about feel, decide yourself when it is
  about correctness.
- Ship small, deploy, let him and the designer test on real files.
