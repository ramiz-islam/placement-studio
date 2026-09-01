/**
 * Geometry shared by the on-screen preview and the canvas exporter.
 *
 * One rule keeps the two in sync: every position is a fraction of the
 * placement canvas, never a screen pixel. What you drag is what gets
 * rendered into the file.
 */

import { FONT, isRTL, type Design, type Placement, type SafeBox } from "./core";

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * The position a given placement actually uses: its own override if it has one,
 * otherwise the shared default. This is what keeps a drag local to the frame it
 * happened on.
 */
export const layersFor = (d: Design, placementId: string): Design["layers"] =>
  d.overrides[placementId] ?? d.layers;

export const hasOverride = (d: Design, placementId: string): boolean =>
  Boolean(d.overrides[placementId]);

/** #RRGGBB + 0-100 opacity -> rgba() */
export function rgba(hex: string, opacity: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
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
  const n = parseInt(hex.replace("#", ""), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
};

/* ---------- text measurement ---------- */

let mctx: CanvasRenderingContext2D | null = null;
function ctx(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  if (!mctx) mctx = document.createElement("canvas").getContext("2d");
  return mctx;
}

export function measure(text: string, fontCss: string, weight: number, sizePx: number): number {
  const g = ctx();
  if (!g) return text.length * sizePx * 0.55; // server-side estimate
  g.font = `${weight} ${sizePx}px ${fontCss}`;
  return g.measureText(text).width;
}

export function wrapLines(
  text: string,
  fontCss: string,
  weight: number,
  sizePx: number,
  maxPx: number
): string[] {
  if (!text) return [];
  const g = ctx();
  if (g) g.font = `${weight} ${sizePx}px ${fontCss}`;
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const wd of words) {
    const test = cur ? `${cur} ${wd}` : wd;
    const width = g ? g.measureText(test).width : test.length * sizePx * 0.55;
    if (width > maxPx && cur) {
      lines.push(cur);
      cur = wd;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/* ---------- layer boxes ---------- */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutResult {
  head: Box & {
    lines: string[];
    headPx: number;
    brandPx: number;
    lh: number;
    font: ReturnType<typeof FONT>;
    rtl: boolean;
  };
  cta: Box & { ctaPx: number; rtl: boolean };
  logo: Box;
}

/** Geometry of every copy layer, in fractions of the placement canvas. */
export function layout(pl: Placement, d: Design, logoAspect = 0.3): LayoutResult {
  const F = FONT(d.headFont);
  const W = pl.w;
  const H = pl.h;
  const rtl = isRTL(d.lang);
  const lh = rtl ? Math.max(F.lh, 1.38) : F.lh;

  const lay = layersFor(d, pl.id);
  const blockPx = (W * d.blockW) / 100;
  const headPx = (W * d.size) / 100;
  // brand and CTA sizes are their own values — changing the headline must not
  // silently resize either of them
  const brandPx = (W * d.brandSize) / 100;
  const ctaPx = (W * d.ctaSize) / 100;

  const lines = wrapLines(d.head, F.css, F.weight, headPx, blockPx);
  const brandH = d.brand ? brandPx * 1.5 : 0;
  const gap = d.brand ? headPx * 0.22 : 0;
  const headH = lines.length * headPx * lh;

  const ctaW = d.cta ? measure(d.cta, F.css, 700, ctaPx) + ctaPx * 2.2 : 0;

  return {
    head: {
      x: lay.head.x,
      y: lay.head.y,
      w: d.blockW / 100,
      h: (brandH + gap + headH) / H,
      lines,
      headPx,
      brandPx,
      lh,
      font: F,
      rtl,
    },
    cta: {
      x: lay.cta.x,
      y: lay.cta.y,
      w: ctaW / W,
      h: (ctaPx * 2.5) / H,
      ctaPx,
      rtl,
    },
    logo: {
      x: lay.logo.x,
      y: lay.logo.y,
      w: d.logoW / 100,
      h: (d.logoW / 100) * logoAspect * (W / H),
    },
  };
}

/** The plate behind the logo, in placement pixels. */
export function logoScrimBox(pl: Placement, L: LayoutResult, d: Design) {
  const w = L.logo.w * pl.w;
  const h = L.logo.h * pl.h;
  const pad = (w * d.logoScrimPad) / 100;
  const shorter = Math.min(w + pad * 2, h + pad * 2);
  return { pad, radius: (shorter * clamp(d.logoScrimRadius, 0, 50)) / 100 };
}

/** The scrim rectangle behind the copy block, in placement pixels. */
export function scrimBox(L: LayoutResult, d: Design) {
  const padX = (L.head.headPx * d.scrimPad) / 100;
  return { padX, padY: padX * 0.8, radius: L.head.headPx * 0.35 };
}

export interface Intrusion {
  top: number;
  bottom: number;
  left: number;
  right: number;
  worst: number;
  side: "top" | "bottom" | "left" | "right" | null;
}

/** How far a layer pushes into a reserved band, in placement pixels. */
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
  /** the placement that sets the deepest bottom band */
  deepest: Placement;
  safeW: number;
  safeH: number;
}

/**
 * The intersection of every reserved band across placements of the same
 * ratio — the box one layout can live in and clear all of them.
 * Returned as fractions, plus the resulting pixel size on `pl`.
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

/** Position the three layers inside a target box, stacked and padded. */
export function snapped(pl: Placement, d: Design, zone: SafeBox, logoAspect: number): Design["layers"] {
  const L = layout(pl, d, logoAspect);
  const pad = 0.02;
  const top = zone.t + pad;
  const bot = 1 - zone.b - pad;
  const left = zone.l + pad;
  const right = 1 - zone.r - pad;
  const stackH = L.head.h + (d.cta ? L.cta.h + 0.02 : 0);
  const startY = clamp(top + (bot - top - stackH) / 2, top, Math.max(top, bot - stackH));
  const rtl = isRTL(d.lang);
  return {
    head: { x: rtl ? clamp(right - L.head.w, left, right) : left, y: startY },
    cta: { x: rtl ? clamp(right - L.cta.w, left, right) : left, y: startY + L.head.h + 0.02 },
    logo: { x: rtl ? clamp(right - L.logo.w, left, right) : left, y: top },
  };
}
