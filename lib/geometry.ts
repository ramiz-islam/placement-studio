/**
 * Geometry shared by the on-screen preview and the canvas exporter.
 *
 * One rule keeps the two in sync: every position is a fraction of the
 * placement canvas, never a screen pixel. What you drag is what gets
 * rendered into the file.
 */

import { FONT, isRTL, type Design, type Fit, type Lang, type Placement, type Pt, type SafeBox } from "./core";
import { ICON, type Align, type Layer, type LayerPatch, type TextLayer } from "./layers";

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * Keep a dragged layer partly on the frame.
 *
 * Bleeding a shape off the edge is a real technique, so a layer may go almost
 * entirely outside — but never fully, because a layer you cannot see is a layer
 * you cannot get back.
 */
export const MIN_ON_FRAME = 0.12;

export function clampPos(box: { w: number; h: number }, x: number, y: number) {
  const w = Math.max(box.w, 0.02);
  const h = Math.max(box.h, 0.02);
  return {
    x: clamp(x, -(w * (1 - MIN_ON_FRAME)), 1 - w * MIN_ON_FRAME),
    y: clamp(y, -(h * (1 - MIN_ON_FRAME)), 1 - h * MIN_ON_FRAME),
  };
}

/** Crop or letterbox is a per-channel decision, with a shared default. */
export const fitFor = (d: Design, placementId: string): Fit => d.fitOverrides[placementId] ?? d.fit;
export const hasFitOverride = (d: Design, placementId: string) => placementId in d.fitOverrides;

/**
 * The position a layer actually uses on a given placement: its own override if
 * it has one, otherwise the layer's shared default. This is what keeps a drag
 * local to the frame it happened on.
 */
/**
 * The layer as this placement sees it: the shared layer with that placement's
 * hand-made adjustments laid over the top.
 */
export function resolveLayer<T extends Layer>(d: Design, placementId: string, layer: T): T {
  const patch = d.overrides[placementId]?.[layer.id];
  return patch ? ({ ...layer, ...patch } as T) : layer;
}

export const posFor = (d: Design, placementId: string, layer: Layer): Pt =>
  resolveLayer(d, placementId, layer).pos;

/** What this placement overrides for one layer, if anything. */
export const patchFor = (d: Design, placementId: string, layerId: string): LayerPatch | undefined =>
  d.overrides[placementId]?.[layerId];

export const hasOverride = (d: Design, placementId: string, layerId?: string): boolean => {
  const per = d.overrides[placementId];
  if (!per) return false;
  return layerId ? Boolean(per[layerId]) : Object.keys(per).length > 0;
};

/** #RRGGBB + 0-100 opacity -> rgba() */
export function rgba(hex: string, opacity: number): string {
  const n = parseInt((hex || "#000000").replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${(clamp(opacity, 0, 100) / 100).toFixed(3)})`;
}

/** Reserved bands as fractions of the canvas. */
export const safeF = (pl: Placement) => ({
  t: pl.safe.t / pl.h,
  b: pl.safe.b / pl.h,
  l: pl.safe.l / pl.w,
  r: pl.safe.r / pl.w,
});

/** Where the source image lands inside a destination canvas. */
export function coverRect(iw: number, ih: number, w: number, h: number, fit: string) {
  const s = fit === "cover" ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
  const dw = iw * s;
  const dh = ih * s;
  return { x: (w - dw) / 2, y: (h - dh) / 2, w: dw, h: dh, s };
}

export const RATIO_LABEL = (r: number): string => {
  const table: [number, string][] = [
    [9 / 16, "9:16"],
    [2 / 3, "2:3"],
    [4 / 5, "4:5"],
    [1, "1:1"],
    [1200 / 628, "1.91:1"],
    [3 / 2, "3:2"],
    [16 / 9, "16:9"],
  ];
  let best = table[0];
  let d = Infinity;
  for (const row of table) {
    const dd = Math.abs(row[0] - r);
    if (dd < d) {
      d = dd;
      best = row;
    }
  }
  return d / best[0] < 0.025 ? best[1] : r.toFixed(2).replace(/0+$/, "") + ":1";
};

export const contrastRatio = (l1: number, l2: number) => {
  const lin = (L: number) => {
    const s = L / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const a = lin(l1);
  const b = lin(l2);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

export const hexLuma = (hex: string) => {
  const n = parseInt((hex || "#000000").replace("#", ""), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
};

/* ---------- text measurement ---------- */

let mctx: CanvasRenderingContext2D | null = null;
function ctx(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  if (!mctx) mctx = document.createElement("canvas").getContext("2d");
  return mctx;
}

export function measure(text: string, fontCss: string, weight: number, sizePx: number, tracking = 0): number {
  const g = ctx();
  const base = g
    ? ((g.font = `${weight} ${sizePx}px ${fontCss}`), g.measureText(text).width)
    : text.length * sizePx * 0.55;
  // canvas letter-spacing is not universally supported, so tracking is added by hand
  return base + tracking * sizePx * Math.max(0, text.length - 1);
}

/* ---------- coloured runs ----------
   Text can carry a second colour: anything inside [square brackets] takes it.
   Wrapping is computed here rather than left to the browser, so the preview and
   the exported file break lines in exactly the same place. */

export interface Run {
  text: string;
  accent: boolean;
}
export interface Token {
  text: string;
  accent: boolean;
  w: number;
}

export function parseRuns(src: string): Run[] {
  const out: Run[] = [];
  const re = /\[([^\]]*)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push({ text: src.slice(last, m.index), accent: false });
    if (m[1]) out.push({ text: m[1], accent: true });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ text: src.slice(last), accent: false });
  return out.filter(r => r.text.length);
}

/** The text with its markup stripped — what a character count should show. */
export const plainText = (src: string) => parseRuns(src).map(r => r.text).join("");

export function tokenize(
  runs: Run[],
  fontCss: string,
  weight: number,
  sizePx: number,
  tracking: number,
  upper: boolean
): Token[] {
  const out: Token[] = [];
  for (const r of runs) {
    for (const raw of r.text.split(/\s+/).filter(Boolean)) {
      const word = upper ? raw.toUpperCase() : raw;
      out.push({ text: word, accent: r.accent, w: measure(word, fontCss, weight, sizePx, tracking) });
    }
  }
  return out;
}

export function wrapTokens(tokens: Token[], spaceW: number, maxPx: number): Token[][] {
  const lines: Token[][] = [];
  let line: Token[] = [];
  let width = 0;
  for (const t of tokens) {
    const add = line.length ? spaceW + t.w : t.w;
    if (width + add > maxPx && line.length) {
      lines.push(line);
      line = [t];
      width = t.w;
    } else {
      line.push(t);
      width += add;
    }
  }
  if (line.length) lines.push(line);
  return lines;
}

export const lineWidth = (line: Token[], spaceW: number) =>
  line.reduce((a, t) => a + t.w, 0) + spaceW * Math.max(0, line.length - 1);

/* ---------- picking which words take the second colour ----------
   The [bracket] syntax is the storage format; nobody should have to type it.
   These turn the text into a list of words the UI can toggle, and back again. */

export interface WordFlag {
  word: string;
  accent: boolean;
}

export function wordFlags(src: string): WordFlag[] {
  const out: WordFlag[] = [];
  for (const r of parseRuns(src)) {
    for (const w of r.text.split(/\s+/).filter(Boolean)) out.push({ word: w, accent: r.accent });
  }
  return out;
}

/** Rebuild the text, wrapping each run of accented words in one bracket pair. */
export function fromWordFlags(flags: WordFlag[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < flags.length) {
    const accent = flags[i].accent;
    const group: string[] = [];
    while (i < flags.length && flags[i].accent === accent) {
      group.push(flags[i].word);
      i++;
    }
    parts.push(accent ? `[${group.join(" ")}]` : group.join(" "));
  }
  return parts.join(" ");
}

export function toggleWord(src: string, index: number): string {
  const flags = wordFlags(src);
  if (!flags[index]) return src;
  flags[index] = { ...flags[index], accent: !flags[index].accent };
  return fromWordFlags(flags);
}

/* ============================================================
   LAYER GEOMETRY
   ============================================================ */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextMetrics {
  kind: "text";
  align: Align;
  lines: Token[][];
  spaceW: number;
  sizePx: number;
  lh: number;
  fontCss: string;
  weight: number;
  rtl: boolean;
}
export interface CtaMetrics {
  kind: "cta";
  sizePx: number;
  fontCss: string;
  pillW: number;
  pillH: number;
}
export interface LogoMetrics {
  kind: "logo";
  aspect: number;
}
export interface ShapeMetrics {
  kind: "shape";
}
export interface IconMetrics {
  kind: "icon";
  path: string;
}
export interface ScreenMetrics {
  kind: "screen";
}
export type Metrics = TextMetrics | CtaMetrics | LogoMetrics | ShapeMetrics | IconMetrics | ScreenMetrics;

export interface Placed {
  layer: Layer;
  /** the layout box, in fractions of the placement canvas */
  box: Box;
  /**
   * What is actually painted, when that is smaller than the layout box.
   *
   * A text block is as wide as `blockW` whether or not the words fill it, so a
   * left-aligned headline in an 80% block reported a box crossing the right
   * reserved band while the glyphs stopped well short of it. `box` still drives
   * dragging, scrims and alignment — the things that should follow the block —
   * and `ink` is what the audit measures, because that is what a viewer sees.
   *
   * Absent means the two are the same.
   */
  ink?: Box;
  metrics: Metrics;
}

/** What is really painted: the ink box when there is one, else the layout box. */
export const inkOf = (p: Placed): Box => p.ink ?? p.box;

export interface LayoutContext {
  lang: Lang;
  /** natural height / natural width of the primary logo */
  logoAspect: number;
  /** the same, per kit logo id, for layers that picked a different one */
  logoAspects?: Record<string, number>;
}

/** The aspect a logo layer lays out with: its own logo's if it picked one, else the primary's. */
export const logoAspectFor = (c: LayoutContext, layer: { logoId?: string | null }): number =>
  (layer.logoId ? c.logoAspects?.[layer.logoId] : undefined) ?? c.logoAspect;

/** Geometry for one layer on one placement. */
export function place(pl: Placement, d: Design, raw: Layer, c: LayoutContext, placementId = pl.id): Placed {
  // every dimension below reads from the resolved layer, so a per-placement
  // resize or rotation is reflected in the preview, the audit and the export
  const layer = resolveLayer(d, placementId, raw);
  const pos = layer.pos;
  const W = pl.w;
  const H = pl.h;
  const rtl = isRTL(c.lang);

  switch (layer.kind) {
    case "text": {
      const F = FONT(layer.font);
      const sizePx = (W * layer.size) / 100;
      const blockPx = (W * layer.blockW) / 100;
      const lh = layer.lineHeight ?? (rtl ? Math.max(F.lh, 1.38) : F.lh);
      const spaceW = measure(" ", F.css, F.weight, sizePx);
      const lines = wrapTokens(
        tokenize(parseRuns(layer.text), F.css, F.weight, sizePx, layer.tracking, layer.upper),
        spaceW,
        blockPx
      );
      if (layer.vertical) {
        /*
         * Stacked: one column, one glyph per row. Wrapping by width has no
         * meaning here, so blockW is ignored and the column is as tall as the
         * glyph count — which makes the height predictable and the overflow
         * obvious rather than silently clipped.
         */
        const glyphs = [...plainText(layer.text).replace(/\s+/g, " ").trim()];
        const colW = sizePx * 1.05;
        const colH = glyphs.length * sizePx * lh;
        const boxV = { x: pos.x, y: pos.y, w: colW / W, h: colH / H };
        return {
          layer,
          box: boxV,
          ink: boxV,
          metrics: {
            kind: "text",
            align: "center",
            lines: glyphs.map(ch => [{ text: ch, w: measure(ch, F.css, F.weight, sizePx), accent: false }]),
            spaceW,
            sizePx,
            lh,
            fontCss: F.css,
            weight: F.weight,
            rtl,
          },
        };
      }

      // the widest line is the real extent; where it sits depends on alignment
      const widest = lines.reduce((a, ln) => Math.max(a, lineWidth(ln, spaceW)), 0);
      const slack = Math.max(0, blockPx - widest);
      const inkDX = layer.align === "center" ? slack / 2 : layer.align === "right" ? slack : 0;
      return {
        layer,
        box: { x: pos.x, y: pos.y, w: layer.blockW / 100, h: (lines.length * sizePx * lh) / H },
        ink: {
          x: pos.x + (rtl ? slack - inkDX : inkDX) / W,
          y: pos.y,
          w: widest / W,
          h: (lines.length * sizePx * lh) / H,
        },
        metrics: {
          kind: "text",
          align: layer.align ?? (rtl ? "right" : "left"),
          lines,
          spaceW,
          sizePx,
          lh,
          fontCss: F.css,
          weight: F.weight,
          rtl,
        },
      };
    }
    case "cta": {
      const F = FONT(layer.font);
      const sizePx = (W * layer.size) / 100;
      const pillW = measure(layer.text, F.css, 700, sizePx) + sizePx * 2.2;
      const pillH = sizePx * 2.5;
      return {
        layer,
        box: { x: pos.x, y: pos.y, w: pillW / W, h: pillH / H },
        metrics: { kind: "cta", sizePx, fontCss: F.css, pillW, pillH },
      };
    }
    case "logo": {
      const w = layer.w / 100;
      return {
        layer,
        box: { x: pos.x, y: pos.y, w, h: w * logoAspectFor(c, layer) * (W / H) },
        metrics: { kind: "logo", aspect: logoAspectFor(c, layer) },
      };
    }
    case "shape": {
      const band = layer.shape === "band";
      const w = band ? 1 : layer.w / 100;
      const x = band ? 0 : pos.x;
      const h = layer.shape === "line" ? Math.max(layer.h / 100, 0.002) : layer.h / 100;
      // a rotated shape occupies its rotated bounding box, which is what the
      // safe-zone check has to measure
      return { layer, box: rotatedBox({ x, y: pos.y, w, h }, layer.rotation ?? 0, W, H), metrics: { kind: "shape" } };
    }
    case "screen": {
      const box = { x: pos.x, y: pos.y, w: layer.w / 100, h: layer.h / 100 };
      return { layer, box, metrics: { kind: "screen" } };
    }

    case "icon": {
      const w = layer.w / 100;
      return {
        layer,
        box: rotatedBox({ x: pos.x, y: pos.y, w, h: w * (W / H) }, layer.rotation ?? 0, W, H),
        metrics: { kind: "icon", path: ICON(layer.icon).d },
      };
    }
  }
}

/**
 * The axis-aligned box a rotated rectangle actually covers, keeping the same
 * centre. Used so the safe-zone audit measures what is really on screen.
 */
export function rotatedBox(box: Box, deg: number, W: number, H: number): Box {
  if (!deg) return box;
  const rad = (deg * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  // work in pixels so width and height are comparable, then convert back
  const wpx = box.w * W;
  const hpx = box.h * H;
  const nw = (wpx * c + hpx * s) / W;
  const nh = (wpx * s + hpx * c) / H;
  return { x: box.x + (box.w - nw) / 2, y: box.y + (box.h - nh) / 2, w: nw, h: nh };
}

/** Every visible layer, in paint order. */
export const placeAll = (pl: Placement, d: Design, c: LayoutContext, placementId = pl.id): Placed[] =>
  d.layers.filter(l => l.on).map(l => place(pl, d, l, c, placementId));

/** The plate around a text layer, in placement pixels. */
export function plateBox(pl: Placement, p: Placed) {
  const l = p.layer as TextLayer;
  const base = p.metrics.kind === "text" ? p.metrics.sizePx : p.box.w * pl.w;
  const padX = (base * l.scrim.pad) / 100;
  return { padX, padY: padX * 0.8, radius: (base * l.scrim.radius) / 100 };
}

export interface Intrusion {
  top: number;
  bottom: number;
  left: number;
  right: number;
  worst: number;
  side: "top" | "bottom" | "left" | "right" | null;
}

/** How far a box pushes into a reserved band, in placement pixels. */
export function intrusion(pl: Placement, box: Box): Intrusion {
  const f = safeF(pl);
  const top = Math.max(0, f.t - box.y) * pl.h;
  const bottom = Math.max(0, box.y + box.h - (1 - f.b)) * pl.h;
  const left = Math.max(0, f.l - box.x) * pl.w;
  const right = Math.max(0, box.x + box.w - (1 - f.r)) * pl.w;
  const worst = Math.max(top, bottom, left, right);
  const side =
    worst === 0 ? null : worst === top ? "top" : worst === bottom ? "bottom" : worst === left ? "left" : "right";
  return { top, bottom, left, right, worst: Math.round(worst), side };
}

/* ---------- master safe zone ---------- */

export interface MasterZone extends SafeBox {
  group: Placement[];
  deepest: Placement;
  safeW: number;
  safeH: number;
}

/**
 * The intersection of every reserved band across placements of the same ratio —
 * the box one layout can live in and clear all of them.
 */
export function masterZone(pl: Placement, all: Placement[]): MasterZone {
  const group = all.filter(p => Math.abs(p.w / p.h - pl.w / pl.h) < 0.03);
  const t = Math.max(...group.map(p => p.safe.t / p.h));
  const b = Math.max(...group.map(p => p.safe.b / p.h));
  const l = Math.max(...group.map(p => p.safe.l / p.w));
  const r = Math.max(...group.map(p => p.safe.r / p.w));
  const deepest = group.reduce((x, p) => (p.safe.b / p.h > x.safe.b / x.h ? p : x));
  return {
    t,
    b,
    l,
    r,
    group,
    deepest,
    safeW: Math.round(pl.w * (1 - l - r)),
    safeH: Math.round(pl.h * (1 - t - b)),
  };
}

/* ---------- alignment ---------- */

export type AlignEdge = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

/**
 * Align a set of placed layers.
 *
 * With one layer selected the reference is the frame, which is what "centre this
 * headline" means. With two or more it is the selection's own bounding box, so
 * centring a caption on a band moves the caption and leaves the band — the band
 * already spans the box.
 */
export function alignedPositions(
  placed: Placed[],
  edge: AlignEdge,
  d: Design,
  placementId: string
): Record<string, LayerPatch> {
  if (!placed.length) return {};
  const single = placed.length === 1;
  const minX = single ? 0 : Math.min(...placed.map(p => p.box.x));
  const maxX = single ? 1 : Math.max(...placed.map(p => p.box.x + p.box.w));
  const minY = single ? 0 : Math.min(...placed.map(p => p.box.y));
  const maxY = single ? 1 : Math.max(...placed.map(p => p.box.y + p.box.h));

  const out: Record<string, LayerPatch> = {};
  for (const p of placed) {
    const cur = posFor(d, placementId, p.layer);
    // a band spans the frame; only its vertical position is meaningful
    const isBand = p.layer.kind === "shape" && p.layer.shape === "band";
    let { x, y } = cur;
    switch (edge) {
      case "left":
        if (!isBand) x = minX;
        break;
      case "hcenter":
        if (!isBand) x = minX + (maxX - minX - p.box.w) / 2;
        break;
      case "right":
        if (!isBand) x = maxX - p.box.w;
        break;
      case "top":
        y = minY;
        break;
      case "vcenter":
        y = minY + (maxY - minY - p.box.h) / 2;
        break;
      case "bottom":
        y = maxY - p.box.h;
        break;
    }
    out[p.layer.id] = { ...(d.overrides[placementId]?.[p.layer.id] ?? {}), pos: { x, y } };
  }
  return out;
}

/**
 * Stack every visible layer inside a target box, in list order, and return the
 * positions. Bands keep their own vertical position — a full-width strip is
 * furniture, not part of the stack.
 */
export interface SnapLines {
  /** vertical lines, as fractions of frame width */
  x: number[];
  /** horizontal lines, as fractions of frame height */
  y: number[];
}

/**
 * The lines a dragged layer should stick to: the safe box, the frame's centre
 * and edges, and the edges and centres of every other visible layer.
 *
 * Alignment is most of the work in laying out an ad and it was entirely by eye,
 * which is why so many layers ended up a pixel or two off the safe box and the
 * audit kept flagging them. Snapping puts them exactly on the line instead.
 */
export function snapLines(pl: Placement, placed: Placed[], exceptIds: string[]): SnapLines {
  const f = safeF(pl);
  const x = [0, 0.5, 1, f.l, 1 - f.r];
  const y = [0, 0.5, 1, f.t, 1 - f.b];
  for (const p of placed) {
    if (!p.layer.on || exceptIds.includes(p.layer.id)) continue;
    const b = p.box;
    x.push(b.x, b.x + b.w / 2, b.x + b.w);
    y.push(b.y, b.y + b.h / 2, b.y + b.h);
  }
  return { x, y };
}

/**
 * Pull a box onto the nearest line, if one is close enough.
 *
 * Each of the box's own three anchors — near edge, centre, far edge — is tested
 * against every line, and the smallest correction inside `tol` wins. Returns
 * the adjusted position and which lines matched, so the caller can draw them.
 */
export function snapBox(
  box: { x: number; y: number; w: number; h: number },
  lines: SnapLines,
  tolX: number,
  tolY: number
): { x: number; y: number; hitX: number | null; hitY: number | null } {
  let bestX: { d: number; line: number } | null = null;
  for (const anchor of [box.x, box.x + box.w / 2, box.x + box.w]) {
    for (const line of lines.x) {
      const d = line - anchor;
      if (Math.abs(d) <= tolX && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, line };
    }
  }
  let bestY: { d: number; line: number } | null = null;
  for (const anchor of [box.y, box.y + box.h / 2, box.y + box.h]) {
    for (const line of lines.y) {
      const d = line - anchor;
      if (Math.abs(d) <= tolY && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, line };
    }
  }
  return {
    x: box.x + (bestX?.d ?? 0),
    y: box.y + (bestY?.d ?? 0),
    hitX: bestX?.line ?? null,
    hitY: bestY?.line ?? null,
  };
}

/**
 * Per-placement patches that put imported layers through the same crop the
 * artwork gets.
 *
 * An import arrives with positions as fractions of the *source* canvas. The
 * artwork is then drawn with cover (or contain) into each placement, which
 * crops it whenever the ratios differ — but the layers were not cropped with
 * it, so a 1.91:1 design on a 9:16 slot slid apart from its own background.
 * This maps every layer's position and size through the rect the artwork
 * actually occupies in each placement, so the composition holds everywhere and
 * anything outside the crop falls outside the frame, exactly as the artwork
 * does. Type sizes and block widths scale with the source's width in the
 * frame, since both are percentages of frame width.
 */
export function importOverrides(
  layers: Layer[],
  srcW: number,
  srcH: number,
  placements: Placement[],
  fitOf: (pl: Placement) => Fit
): Record<string, Record<string, LayerPatch>> {
  const out: Record<string, Record<string, LayerPatch>> = {};
  for (const pl of placements) {
    const r = coverRect(srcW, srcH, pl.w, pl.h, fitOf(pl));
    const sx = r.w / pl.w;
    const sy = r.h / pl.h;
    const ox = r.x / pl.w;
    const oy = r.y / pl.h;
    // the matching ratio maps to the identity; nothing to write there
    if (Math.abs(sx - 1) < 1e-6 && Math.abs(sy - 1) < 1e-6) continue;
    const per: Record<string, LayerPatch> = {};
    for (const l of layers) {
      const patch: LayerPatch = { pos: { x: ox + l.pos.x * sx, y: oy + l.pos.y * sy } };
      switch (l.kind) {
        case "text":
          patch.size = l.size * sx;
          patch.blockW = l.blockW * sx;
          break;
        case "cta":
          patch.size = l.size * sx;
          break;
        case "shape":
          if (l.shape !== "band") patch.w = l.w * sx;
          patch.h = l.h * sy;
          break;
        case "screen":
          patch.w = l.w * sx;
          patch.h = l.h * sy;
          break;
        case "logo":
        case "icon":
          patch.w = l.w * sx;
          break;
      }
      per[l.id] = patch;
    }
    out[pl.id] = per;
  }
  return out;
}

export function stackInside(
  pl: Placement,
  d: Design,
  zone: SafeBox,
  c: LayoutContext,
  placementId = pl.id
): Record<string, LayerPatch> {
  const pad = 0.02;
  const top = zone.t + pad;
  const bot = 1 - zone.b - pad;
  const left = zone.l + pad;
  const right = 1 - zone.r - pad;
  const rtl = isRTL(c.lang);

  const placed = placeAll(pl, d, c, placementId);
  const stacked = placed.filter(p => !(p.layer.kind === "shape" && p.layer.shape === "band"));
  const gap = 0.015;
  const total = stacked.reduce((a, p) => a + p.box.h, 0) + gap * Math.max(0, stacked.length - 1);
  let y = clamp(top + (bot - top - total) / 2, top, Math.max(top, bot - total));

  const out: Record<string, LayerPatch> = {};
  const keep = (id: string) => d.overrides[placementId]?.[id] ?? {};
  for (const p of placed) {
    if (p.layer.kind === "shape" && p.layer.shape === "band") {
      out[p.layer.id] = { ...keep(p.layer.id), pos: { x: 0, y: clamp(p.layer.pos.y, 0, 1 - p.box.h) } };
      continue;
    }
    out[p.layer.id] = {
      ...keep(p.layer.id),
      pos: { x: rtl ? clamp(right - p.box.w, left, right) : left, y },
    };
    y += p.box.h + gap;
  }
  return out;
}
