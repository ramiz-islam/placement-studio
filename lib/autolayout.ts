/**
 * Placing the copy by looking at the artwork.
 *
 * "Snap into the safe box" only ever knew where the platform's furniture was,
 * so it would happily stack a logo across a face or a hand — inside the safe
 * box, and unreadable. This module scores candidate positions against the
 * image itself: how much detail is under them, and whether the type has enough
 * tonal contrast against what it sits on.
 *
 * It is a heuristic over detail density, not object recognition. It reliably
 * finds sky, road, wall and out-of-focus background, which is what a designer
 * reaches for anyway.
 */

import { isRTL, type Design, type Placement, type SafeBox } from "./core";
import { type DetailMap, busyOfRect, lumaOfRect } from "./analysis";
import { type LayoutContext, type Placed, placeAll } from "./geometry";
import type { LayerPatch } from "./layers";

/** Relative luminance of a hex colour, 0-255, to compare against the artwork. */
function inkLuma(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 255;
  const n = parseInt(m[1], 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
}

/**
 * What a rect costs as a home for one layer: busy artwork is bad, and for type
 * so is a background of the same tone as the ink.
 */
function cost(m: DetailMap, r: { x: number; y: number; w: number; h: number }, ink: string | null): number {
  const busy = busyOfRect(m, r.x, r.y, r.w, r.h);
  if (!ink) return busy;
  const bg = lumaOfRect(m, r.x, r.y, r.w, r.h);
  // 110 points of separation is comfortable; below that the type starts to sink
  const contrast = Math.min(1, Math.abs(bg - inkLuma(ink)) / 110);
  return busy + 1.4 * (1 - contrast);
}

/**
 * Is a rect too busy for type to survive on it unaided?
 *
 * Two signals, because either alone is blind. `busyOfRect` is relative to the
 * frame, so on artwork that is busy from edge to edge every region scores about
 * 1.0 and nothing ever looks bad. The frame's own mean edge energy supplies the
 * absolute reading: `collision` already treats a single cell above 9 as real
 * detail, so a whole region averaging that much is not somewhere a headline can
 * sit unhelped.
 */
function tooBusy(m: DetailMap, r: { x: number; y: number; w: number; h: number }): boolean {
  const rel = busyOfRect(m, r.x, r.y, r.w, r.h);
  return rel > 1.15 || rel * m.mean > 10;
}

const overlaps = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The ink colour a layer is read in, or null for anything that is not type. */
function inkOf(p: Placed): string | null {
  const l = p.layer;
  if (l.kind === "text") return l.scrim.on ? null : l.color;
  // a button carries its own background, so only its plate matters
  if (l.kind === "cta") return null;
  return null;
}

export interface AutoLayoutResult {
  patches: Record<string, LayerPatch>;
  /**
   * Every layer whose best available spot is still busy — reported whether or
   * not it already has a plate. Answering "which ones are missing a plate"
   * instead made the set empty on a second pass, and a caller that clears what
   * is not in the set then switched the plates back off.
   */
  plates: string[];

  /** what it decided, in a sentence, so the move is not a mystery */
  note: string;
}

/**
 * Place the logo and the copy block inside `zone`, avoiding the busiest parts
 * of the artwork. Shapes, bands and icons are left where they are: they are
 * design furniture and the user put them somewhere on purpose.
 */
export function autoLayout(
  pl: Placement,
  d: Design,
  zone: SafeBox,
  c: LayoutContext,
  m: DetailMap,
  placementId = pl.id
): AutoLayoutResult {
  const pad = 0.02;
  const top = zone.t + pad;
  const bot = 1 - zone.b - pad;
  const left = zone.l + pad;
  const right = 1 - zone.r - pad;
  const rtl = isRTL(c.lang);

  const placed = placeAll(pl, d, c, placementId).filter(p => p.layer.on);
  const logo = placed.find(p => p.layer.kind === "logo") ?? null;
  const copy = placed.filter(p => p.layer.kind === "text" || p.layer.kind === "cta");

  const patches: Record<string, LayerPatch> = {};
  /** layers the artwork is too busy for, which need a plate behind them */
  const plates: string[] = [];
  const keep = (id: string) => d.overrides[placementId]?.[id] ?? {};
  const put = (id: string, x: number, y: number) => {
    patches[id] = { ...keep(id), pos: { x, y } };
  };

  /* ---------- the copy block ---------- */

  const gap = 0.015;
  const blockH = copy.reduce((a, p) => a + p.box.h, 0) + gap * Math.max(0, copy.length - 1);
  const blockW = Math.max(0.0001, ...copy.map(p => p.box.w));
  // the type in the block, so contrast is judged against what people read
  const blockInk = copy.map(inkOf).find(Boolean) ?? null;

  let bestBlock = { x: rtl ? right - blockW : left, y: top, cost: Infinity };
  const xChoices = [left, Math.max(left, right - blockW), left + (right - left - blockW) / 2].filter(
    x => x >= left - 1e-6 && x + blockW <= right + 1e-6
  );
  const steps = 28;
  for (const x of xChoices.length ? xChoices : [left]) {
    for (let i = 0; i <= steps; i++) {
      const y = top + ((bot - blockH - top) * i) / steps;
      if (y < top - 1e-6 || y + blockH > bot + 1e-6) continue;
      let sc = cost(m, { x, y, w: blockW, h: blockH }, blockInk);
      // copy low in the frame is the convention; nudge ties that way
      sc -= 0.12 * ((y - top) / Math.max(1e-6, bot - blockH - top));
      // and hold the reading edge unless the other side is clearly quieter
      if (rtl ? x !== right - blockW : x !== left) sc += 0.1;
      if (sc < bestBlock.cost) bestBlock = { x, y, cost: sc };
    }
  }

  let y = bestBlock.y;
  for (const p of copy) {
    put(p.layer.id, bestBlock.x, y);
    y += p.box.h + gap;
  }
  const blockRect = { x: bestBlock.x, y: bestBlock.y, w: blockW, h: blockH };

  /* ---------- the logo ---------- */

  let logoNote = "";
  if (logo) {
    const lw = logo.box.w;
    const lh = logo.box.h;
    /*
     * Scan the whole safe box rather than a handful of corners. Six fixed
     * corners fail exactly when it matters: if the top is busy and the bottom
     * is taken by the copy, every candidate is bad and the logo lands on a
     * hand. A scan finds the gap beside or above the copy instead.
     */
    const cols = 9;
    const rows = 11;
    let best: { x: number; y: number; cost: number } | null = null;
    for (let ri = 0; ri <= rows; ri++) {
      for (let ci = 0; ci <= cols; ci++) {
        const x = left + ((right - left - lw) * ci) / cols;
        const y = top + ((bot - top - lh) * ri) / rows;
        if (x < left - 1e-6 || x + lw > right + 1e-6) continue;
        if (y < top - 1e-6 || y + lh > bot + 1e-6) continue;
        const r = { x, y, w: lw, h: lh };
        let sc = cost(m, r, null);
        // never sit on the copy
        if (overlaps(r, blockRect)) sc += 4;
        // a logo belongs against an edge, not floating in the middle
        const edge = Math.min(x - left, right - lw - x, y - top, bot - lh - y);
        sc += 2.2 * edge;
        // and the top of the frame is the habit, so break ties there
        if (y > (top + bot) / 2) sc += 0.18;
        if (!best || sc < best.cost) best = { x, y, cost: sc };
      }
    }
    const spot = best ?? { x: left, y: top, cost: 0 };
    put(logo.layer.id, spot.x, spot.y);

    const busyHere = tooBusy(m, { x: spot.x, y: spot.y, w: lw, h: lh });
    if (busyHere) plates.push(logo.layer.id);
    const where =
      (spot.y < (top + bot) / 2 ? "top" : "bottom") +
      " " +
      (spot.x < left + (right - left - lw) * 0.33
        ? "left"
        : spot.x > left + (right - left - lw) * 0.66
          ? "right"
          : "centre");
    logoNote = ` Logo ${where}${busyHere ? ", on a scrim — nothing quiet enough was free" : ""}.`;
  }

  const quiet = busyOfRect(m, blockRect.x, blockRect.y, blockRect.w, blockRect.h);
  const how = tooBusy(m, blockRect) ? "the least busy" : quiet < 0.7 ? "a quiet" : "the quietest available";
  if (tooBusy(m, blockRect)) {
    for (const p of copy) if (p.layer.kind === "text") plates.push(p.layer.id);
  }

  return {
    patches,
    plates,
    note: `Copy moved to ${how} part of the frame.${logoNote}`,
  };
}
