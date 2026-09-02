/**
 * Image analysis — client only.
 *
 * Composes the creative into each placement canvas exactly as the feed would
 * crop it, then scores every cell of a grid by local edge energy. Cells that
 * are unusually detailed relative to the whole frame are where text and logos
 * live, so a busy cell inside a reserved band is a real collision.
 *
 * This measures detail density, not glyphs. It is deliberately described that
 * way everywhere in the UI.
 */

import { coverRect, safeF } from "./geometry";
import type { Fit, Placement } from "./core";

const AW = 216; // analysis width in px — enough signal, cheap to compute
const CELL = 12;

export interface DetailMap {
  cols: number;
  rows: number;
  cells: Float32Array;
  mean: number;
  w: number;
  h: number;
  lum: Float32Array;
}

export interface Collision {
  ratio: number;
  hit: number;
  reserved: number;
  bands: { top: number; bottom: number; left: number; right: number };
  /** data URL of a cols×rows mask, scaled up with image-rendering: pixelated */
  url: string | null;
}

const cache = new Map<string, DetailMap>();
const colCache = new Map<string, Collision>();

export function clearAnalysisCache() {
  cache.clear();
  colCache.clear();
}

export function detailMap(pl: Placement, img: HTMLImageElement, fit: Fit, padColor: string, ver: number): DetailMap {
  const key = `${pl.id}|${fit}|${ver}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const w = AW;
  const h = Math.max(8, Math.round((AW * pl.h) / pl.w));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  if (fit === "contain") {
    g.fillStyle = padColor;
    g.fillRect(0, 0, w, h);
  }
  const r = coverRect(img.naturalWidth, img.naturalHeight, w, h, fit);
  g.drawImage(img, r.x, r.y, r.w, r.h);

  const data = g.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    lum[i] = 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];
  }
  const edge = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      edge[i] = Math.abs(lum[i + 1] - lum[i - 1]) + Math.abs(lum[i + w] - lum[i - w]);
    }
  }
  const cols = Math.ceil(w / CELL);
  const rows = Math.ceil(h / CELL);
  const cells = new Float32Array(cols * rows);
  let total = 0;
  for (let rr = 0; rr < rows; rr++) {
    for (let cc = 0; cc < cols; cc++) {
      let sum = 0;
      let n = 0;
      for (let y = rr * CELL; y < Math.min((rr + 1) * CELL, h); y++) {
        for (let x = cc * CELL; x < Math.min((cc + 1) * CELL, w); x++) {
          sum += edge[y * w + x];
          n++;
        }
      }
      const v = n ? sum / n : 0;
      cells[rr * cols + cc] = v;
      total += v;
    }
  }
  const out: DetailMap = { cols, rows, cells, mean: total / (cols * rows), w, h, lum };
  cache.set(key, out);
  return out;
}

export function collision(pl: Placement, m: DetailMap, key: string): Collision {
  const cached = colCache.get(key);
  if (cached) return cached;

  const f = safeF(pl);
  const yTop = f.t * m.rows;
  const yBot = (1 - f.b) * m.rows;
  const xL = f.l * m.cols;
  const xR = (1 - f.r) * m.cols;
  const thresh = Math.max(9, m.mean * 1.55);

  const mask = document.createElement("canvas");
  mask.width = m.cols;
  mask.height = m.rows;
  const mg = mask.getContext("2d")!;

  let reserved = 0;
  let hit = 0;
  const bands = { top: 0, bottom: 0, left: 0, right: 0 };
  for (let r = 0; r < m.rows; r++) {
    for (let c = 0; c < m.cols; c++) {
      const inTop = r + 1 <= yTop;
      const inBot = r >= yBot;
      const inL = c + 1 <= xL;
      const inR = c >= xR;
      if (!(inTop || inBot || inL || inR)) continue;
      reserved++;
      const v = m.cells[r * m.cols + c];
      if (v > thresh) {
        hit++;
        if (inTop) bands.top++;
        else if (inBot) bands.bottom++;
        else if (inL) bands.left++;
        else bands.right++;
        const a = Math.min(0.92, 0.42 + (v / thresh - 1) * 0.5);
        mg.fillStyle = `rgba(255,84,80,${a.toFixed(3)})`;
        mg.fillRect(c, r, 1, 1);
      }
    }
  }
  const out: Collision = {
    ratio: reserved ? hit / reserved : 0,
    hit,
    reserved,
    bands,
    url: hit ? mask.toDataURL() : null,
  };
  colCache.set(key, out);
  return out;
}

/** Densest 3×3 neighbourhood — where the eye lands first. */
export function focal(m: DetailMap) {
  let best = -1;
  let bx = 0;
  let by = 0;
  for (let r = 1; r < m.rows - 1; r++) {
    for (let c = 1; c < m.cols - 1; c++) {
      let s = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) s += m.cells[(r + dr) * m.cols + (c + dc)];
      if (s > best) {
        best = s;
        bx = c;
        by = r;
      }
    }
  }
  return { x: (bx + 0.5) / m.cols, y: (by + 0.5) / m.rows };
}

/**
 * How busy a rect is, relative to the whole frame. 1 means average detail, 2
 * means twice as much as average, near 0 means flat. Layout uses this to find
 * somewhere a headline or a logo can sit and still be read.
 */
export function busyOfRect(m: DetailMap, fx: number, fy: number, fw: number, fh: number): number {
  const c0 = Math.max(0, Math.min(m.cols - 1, Math.floor(fx * m.cols)));
  const c1 = Math.max(c0 + 1, Math.min(m.cols, Math.ceil((fx + fw) * m.cols)));
  const r0 = Math.max(0, Math.min(m.rows - 1, Math.floor(fy * m.rows)));
  const r1 = Math.max(r0 + 1, Math.min(m.rows, Math.ceil((fy + fh) * m.rows)));
  let sum = 0;
  let n = 0;
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      sum += m.cells[r * m.cols + c];
      n++;
    }
  }
  if (!n) return 1;
  return m.mean > 0 ? sum / n / m.mean : 0;
}

/** Mean luma under a rect given in canvas fractions. */
export function lumaOfRect(m: DetailMap, fx: number, fy: number, fw: number, fh: number): number {
  const x0 = Math.max(0, Math.min(m.w - 1, Math.floor(fx * m.w)));
  const x1 = Math.max(x0 + 1, Math.min(m.w, Math.ceil((fx + fw) * m.w)));
  const y0 = Math.max(0, Math.min(m.h - 1, Math.floor(fy * m.h)));
  const y1 = Math.max(y0 + 1, Math.min(m.h, Math.ceil((fy + fh) * m.h)));
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    sum += m.lum[y * m.w + x];
    n++;
  }
  return n ? sum / n : 128;
}

/**
 * Is the logo mostly light? Alpha-weighted, because a logo is usually a mark on
 * transparency and the transparent pixels carry no colour worth averaging.
 *
 * Used to choose which brand colour goes behind it: a white mark needs the navy,
 * a navy mark needs the white.
 */
export function logoIsLight(img: HTMLImageElement | null): boolean {
  if (!img || !img.naturalWidth) return true;
  try {
    const n = 24;
    const c = document.createElement("canvas");
    c.width = n;
    c.height = n;
    const g = c.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(img, 0, 0, n, n);
    const d = g.getImageData(0, 0, n, n).data;
    let sum = 0;
    let weight = 0;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3] / 255;
      if (a < 0.15) continue;
      sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) * a;
      weight += a;
    }
    // nothing opaque enough to judge: assume a light mark, the common case
    return weight < 1 ? true : sum / weight > 128;
  } catch {
    return true;
  }
}

/**
 * Crop the transparent border off a logo.
 *
 * A wordmark exported with breathing room is mostly empty pixels, and every
 * measurement downstream is taken from the image box: the layer's height comes
 * from its aspect ratio, and the audit asks whether that box clears the safe
 * zone. So a logo whose ink sat well inside the reserved band still failed,
 * because the invisible padding did not. Trimming once here means the box is
 * the ink, and nothing else needs to know about it.
 *
 * Returns the original source when there is nothing to trim, so an opaque logo
 * costs one canvas read and no re-encode.
 */
export function trimTransparent(src: string): Promise<string> {
  return new Promise(resolve => {
    const img = new Image();
    img.onerror = () => resolve(src);
    img.onload = () => {
      try {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (!w || !h) return resolve(src);
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const g = c.getContext("2d", { willReadFrequently: true })!;
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, w, h).data;

        let top = h;
        let left = w;
        let right = -1;
        let bottom = -1;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            // 8/255 ignores the near-invisible fringe antialiasing leaves behind
            if (d[(y * w + x) * 4 + 3] < 8) continue;
            if (x < left) left = x;
            if (x > right) right = x;
            if (y < top) top = y;
            if (y > bottom) bottom = y;
          }
        }
        if (right < 0 || bottom < 0) return resolve(src);
        const tw = right - left + 1;
        const th = bottom - top + 1;
        // a couple of pixels either side is not worth a re-encode
        if (tw >= w - 2 && th >= h - 2) return resolve(src);

        const out = document.createElement("canvas");
        out.width = tw;
        out.height = th;
        out.getContext("2d")!.drawImage(c, left, top, tw, th, 0, 0, tw, th);
        resolve(out.toDataURL("image/png"));
      } catch {
        resolve(src);
      }
    };
    img.src = src;
  });
}

/** Darkened average of the edge pixels — a believable letterbox colour. */
export function samplePad(img: HTMLImageElement): string {
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 8;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, 8, 8);
  const d = g.getImageData(0, 0, 8, 8).data;
  let r = 0;
  let gg = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < 64; i++) {
    const x = i % 8;
    const y = (i / 8) | 0;
    if (x > 0 && x < 7 && y > 0 && y < 7) continue;
    r += d[i * 4];
    gg += d[i * 4 + 1];
    b += d[i * 4 + 2];
    n++;
  }
  const mix = (v: number) => Math.round((v / n) * 0.55);
  return `rgb(${mix(r)},${mix(gg)},${mix(b)})`;
}
