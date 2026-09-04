/**
 * Canvas exporter. Renders a placement at native resolution, without the
 * platform chrome, from the same layer geometry the preview uses.
 *
 * On "high quality" for ad upload — what actually matters, in order:
 *  1. Exact pixel dimensions for the placement. Platforms resample anything
 *     else, and their resampler is worse than ours.
 *  2. No upscaling of the source. Text, shapes and icons are drawn at full
 *     output resolution, so they stay crisp; only the photograph can soften,
 *     and we warn when it would.
 *  3. Progressive downsampling. A single drawImage from a much larger source
 *     aliases; halving in steps does not.
 *  4. Landing under the platform's file-size cap without visible artefacts,
 *     which is a quality search, not a fixed quality number.
 *  5. sRGB, 8-bit. Every ad platform re-encodes to sRGB — canvas already
 *     normalises to it, and there is no HDR ad format to target.
 */

import type { Design, Fit, Placement } from "./core";
import { CHEVRON, type Fill } from "./layers";
import { drawQuad, type Pt } from "./perspective";
import { coverRect, lineWidth, placeAll, plateBox, rgba, safeF, type LayoutContext, type Placed } from "./geometry";

export type ExportFormat = "image/png" | "image/jpeg" | "image/webp";

export interface RenderOpts {
  scale: number;
  copy: boolean;
  guides: boolean;
  fit: Fit;
  padColor: string;
  img: HTMLImageElement;
  logo: HTMLImageElement | null;
  /** every kit logo by id, for layers that picked one */
  logos?: Record<string, HTMLImageElement>;
  design: Design;
  ctx: LayoutContext;
  /** uploaded shape and icon images, keyed by src — see preloadLayerImages */
  images?: Map<string, HTMLImageElement>;
}

/**
 * Decode every uploaded shape/icon image before a render. Without this an
 * upload can silently miss the export, because drawImage on a half-decoded
 * image is a no-op.
 */
export async function preloadLayerImages(design: Design): Promise<Map<string, HTMLImageElement>> {
  const srcs = new Set<string>();
  for (const l of design.layers) {
    if ((l.kind === "icon" || l.kind === "shape" || l.kind === "screen") && l.src) srcs.add(l.src);
  }
  const out = new Map<string, HTMLImageElement>();
  await Promise.all(
    [...srcs].map(
      src =>
        new Promise<void>(res => {
          const im = new Image();
          im.onload = () => {
            out.set(src, im);
            res();
          };
          im.onerror = () => res();
          im.src = src;
        })
    )
  );
  return out;
}

/** Run a draw inside a rotation about the box centre. */
function rotated(
  g: CanvasRenderingContext2D,
  deg: number,
  x: number,
  y: number,
  w: number,
  h: number,
  draw: (x: number, y: number) => void
) {
  if (!deg) {
    draw(x, y);
    return;
  }
  g.save();
  g.translate(x + w / 2, y + h / 2);
  g.rotate((deg * Math.PI) / 180);
  draw(-w / 2, -h / 2);
  g.restore();
}

/** The path for a shape, ready to fill or clip. */
function shapePath(g: CanvasRenderingContext2D, shape: string, x: number, y: number, w: number, h: number, radius: number) {
  if (shape === "ellipse") {
    g.beginPath();
    g.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    g.closePath();
    return;
  }
  if (shape === "chevron") {
    g.beginPath();
    CHEVRON.forEach(([cx, cy], i) => {
      const px = x + cx * w;
      const py = y + cy * h;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    });
    g.closePath();
    return;
  }
  if (shape === "triangle") {
    g.beginPath();
    g.moveTo(x + w / 2, y);
    g.lineTo(x + w, y + h);
    g.lineTo(x, y + h);
    g.closePath();
    return;
  }
  roundRect(g, x, y, w, h, (Math.min(w, h) * radius) / 100);
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.lineTo(x + w - rr, y);
  g.arcTo(x + w, y, x + w, y + rr, rr);
  g.lineTo(x + w, y + h - rr);
  g.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  g.lineTo(x + rr, y + h);
  g.arcTo(x, y + h, x, y + h - rr, rr);
  g.lineTo(x, y + rr);
  g.arcTo(x, y, x + rr, y, rr);
  g.closePath();
}

/** Solid colour, or a linear gradient across the given box at the fill's angle. */
function paint(g: CanvasRenderingContext2D, f: Fill, x: number, y: number, w: number, h: number): string | CanvasGradient {
  if (!f.color2) return rgba(f.color, f.opacity);
  const rad = ((f.angle % 360) * Math.PI) / 180;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const len = (Math.abs(Math.cos(rad)) * w + Math.abs(Math.sin(rad)) * h) / 2;
  const grad = g.createLinearGradient(
    cx - Math.cos(rad) * len,
    cy - Math.sin(rad) * len,
    cx + Math.cos(rad) * len,
    cy + Math.sin(rad) * len
  );
  grad.addColorStop(0, rgba(f.color, f.opacity));
  grad.addColorStop(1, rgba(f.color2, f.opacity));
  return grad;
}

/**
 * Resample to an exact size, halving in steps when the source is much larger.
 * One big drawImage skips pixels and aliases; this does not.
 */
function resampled(img: HTMLImageElement, w: number, h: number): CanvasImageSource {
  const tw = Math.max(1, Math.round(w));
  const th = Math.max(1, Math.round(h));
  if (img.naturalWidth <= tw * 2 && img.naturalHeight <= th * 2) return img;

  let cw = img.naturalWidth;
  let ch = img.naturalHeight;
  let src: CanvasImageSource = img;
  let canvas: HTMLCanvasElement | null = null;
  while (cw > tw * 2 && ch > th * 2) {
    const nw = Math.max(tw, Math.round(cw / 2));
    const nh = Math.max(th, Math.round(ch / 2));
    const next = document.createElement("canvas");
    next.width = nw;
    next.height = nh;
    const ng = next.getContext("2d")!;
    ng.imageSmoothingEnabled = true;
    ng.imageSmoothingQuality = "high";
    ng.drawImage(src, 0, 0, nw, nh);
    src = next;
    canvas = next;
    cw = nw;
    ch = nh;
  }
  return canvas ?? img;
}

/** How much the source has to stretch to fill this placement. >1 means upscale. */
export function upscaleFactor(pl: Placement, img: HTMLImageElement, fit: Fit, scale: number): number {
  return coverRect(img.naturalWidth, img.naturalHeight, pl.w * scale, pl.h * scale, fit).s;
}

/**
 * Rotate the whole layer, then draw it.
 *
 * Shapes and icons rotate inside their own case, because `p.box` for those is
 * the axis-aligned bounding box of the already-rotated form and the drawing
 * uses the layer's real size. For type, buttons and logos `p.box` is the plain
 * box — the same thing a CSS transform spins without touching layout — so the
 * rotation goes round the outside and every coordinate inside stays as it was.
 */
function drawLayer(
  g: CanvasRenderingContext2D,
  p: Placed,
  pl: Placement,
  o: RenderOpts,
  W: number,
  H: number,
  logoCache: Map<string, HTMLImageElement>
) {
  const deg = p.layer.rotation ?? 0;
  const spinsHere =
    p.layer.kind === "logo" || p.layer.kind === "cta" || p.layer.kind === "text" || p.layer.kind === "screen";
  if (!deg || !spinsHere) {
    drawLayerBody(g, p, pl, o, W, H, logoCache);
    return;
  }
  const cx = (p.box.x + p.box.w / 2) * W;
  const cy = (p.box.y + p.box.h / 2) * H;
  g.save();
  g.translate(cx, cy);
  g.rotate((deg * Math.PI) / 180);
  g.translate(-cx, -cy);
  drawLayerBody(g, p, pl, o, W, H, logoCache);
  g.restore();
}

function drawLayerBody(
  g: CanvasRenderingContext2D,
  p: Placed,
  pl: Placement,
  o: RenderOpts,
  W: number,
  H: number,
  logoCache: Map<string, HTMLImageElement>
) {
  const s = o.scale;
  const x = p.box.x * W;
  const y = p.box.y * H;
  const w = p.box.w * W;
  const h = p.box.h * H;

  switch (p.layer.kind) {
    case "shape": {
      const l = p.layer;
      // p.box is the rotated bounding box; the drawing itself uses the layer's
      // own dimensions, centred in that box
      const band = l.shape === "band";
      const dw = band ? W : (l.w / 100) * W;
      const dh = (l.h / 100) * H;
      const cx = x + w / 2 - dw / 2;
      const cy = y + h / 2 - dh / 2;
      const picture = l.src ? logoCache.get(l.src) : null;

      rotated(g, l.rotation ?? 0, cx, cy, dw, dh, (ox, oy) => {
        if (picture) {
          g.save();
          shapePath(g, l.shape, ox, oy, dw, dh, l.radius);
          g.clip();
          const cr = coverRect(picture.naturalWidth, picture.naturalHeight, dw, dh, l.srcFit === "contain" ? "contain" : "cover");
          g.drawImage(resampled(picture, cr.w, cr.h), ox + cr.x, oy + cr.y, cr.w, cr.h);
          g.restore();
          return;
        }
        g.fillStyle = paint(g, l.fill, ox, oy, dw, dh);
        shapePath(g, l.shape, ox, oy, dw, dh, l.radius);
        g.fill();
      });
      return;
    }

    case "screen": {
      const l = p.layer;
      const shot = l.src ? logoCache.get(l.src) : null;
      if (!shot) return;
      // the same homography the preview used, in device pixels this time
      const quad = l.corners.map(c => ({ x: x + c.x * w, y: y + c.y * h })) as [Pt, Pt, Pt, Pt];
      drawQuad(g, shot, shot.naturalWidth, shot.naturalHeight, quad);
      return;
    }

    case "icon": {
      const l = p.layer;
      const custom = l.src ? logoCache.get(l.src) : null;
      const ih = custom ? w * (custom.naturalHeight / custom.naturalWidth) : w;

      if (l.scrim.on) {
        const pad = (w * l.scrim.pad) / 100;
        const shorter = Math.min(w + pad * 2, ih + pad * 2);
        g.fillStyle = paint(g, l.scrim.fill, x - pad, y - pad, w + pad * 2, ih + pad * 2);
        roundRect(g, x - pad, y - pad, w + pad * 2, ih + pad * 2, (shorter * l.scrim.radius) / 100);
        g.fill();
      }
      const path = p.metrics.kind === "icon" ? p.metrics.path : null;
      rotated(g, l.rotation ?? 0, x, y, w, ih, (ox, oy) => {
        if (custom) {
          g.drawImage(resampled(custom, w, ih), ox, oy, w, ih);
          return;
        }
        if (!path) return;
        g.save();
        g.translate(ox, oy);
        g.scale(w / 24, w / 24);
        g.fillStyle = l.color;
        g.fill(new Path2D(path));
        g.restore();
      });
      return;
    }

    case "logo": {
      const l = p.layer;
      const im = (l.logoId && o.logos?.[l.logoId]) || o.logo;
      if (!im) return;
      const lw = w;
      const lh = lw * (im.naturalHeight / im.naturalWidth);

      if (l.band.on) {
        const pad = (lw * l.band.pad) / 100;
        const by = y - pad;
        const bh = lh + pad * 2;
        g.fillStyle = paint(g, l.band.fill, 0, by, W, bh);
        g.fillRect(0, by, W, bh);
      }
      if (l.plate.on) {
        const pad = (lw * l.plate.pad) / 100;
        const shorter = Math.min(lw + pad * 2, lh + pad * 2);
        g.fillStyle = paint(g, l.plate.fill, x - pad, y - pad, lw + pad * 2, lh + pad * 2);
        roundRect(g, x - pad, y - pad, lw + pad * 2, lh + pad * 2, (shorter * l.plate.radius) / 100);
        g.fill();
      }
      g.drawImage(resampled(im, lw, lh), x, y, lw, lh);
      return;
    }

    case "cta": {
      const l = p.layer;
      if (p.metrics.kind !== "cta") return;
      const pw = p.metrics.pillW * s;
      const ph = p.metrics.pillH * s;
      const sizePx = p.metrics.sizePx * s;
      g.fillStyle = paint(g, l.bg, x, y, pw, ph);
      roundRect(g, x, y, pw, ph, (ph * l.radius) / 100);
      g.fill();
      g.fillStyle = l.ink;
      g.font = `700 ${sizePx}px ${p.metrics.fontCss}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(l.text, x + pw / 2, y + ph / 2 + sizePx * 0.04);
      return;
    }

    case "text": {
      const l = p.layer;
      if (p.metrics.kind !== "text") return;
      const m = p.metrics;
      const sizePx = m.sizePx * s;
      const spaceW = m.spaceW * s;

      if (l.scrim.on) {
        const pb = plateBox(pl, p);
        const padX = pb.padX * s;
        const padY = pb.padY * s;
        g.fillStyle = paint(g, l.scrim.fill, x - padX, y - padY, w + padX * 2, h + padY * 2);
        roundRect(g, x - padX, y - padY, w + padX * 2, h + padY * 2, pb.radius * s);
        g.fill();
      }

      // one gradient across the whole text block, so it reads continuously
      // rather than restarting on every word
      const grad = l.grad?.on
        ? paint(g, { color: l.color, color2: l.grad.to, angle: l.grad.angle, opacity: 100 }, x, y, w, h)
        : null;

      g.font = `${m.weight} ${sizePx}px ${m.fontCss}`;
      g.textBaseline = "top";

      // Stroke first, fill second — the same order paint-order gives the
      // preview. Stroking after the fill would bite into the letterforms.
      const strokePx = l.stroke?.on ? (sizePx * l.stroke.w) / 100 : 0;
      if (strokePx > 0) {
        g.lineJoin = "round";
        g.miterLimit = 2;
        g.strokeStyle = l.stroke.color;
        // canvas centres a stroke on the path, so double it to sit outside
        g.lineWidth = strokePx * 2;
      }
      const withShadow = (draw: () => void) => {
        if (!l.shadow?.on) return draw();
        g.save();
        g.shadowColor = l.shadow.color;
        g.shadowBlur = (sizePx * l.shadow.blur) / 100;
        g.shadowOffsetX = (sizePx * l.shadow.x) / 100;
        g.shadowOffsetY = (sizePx * l.shadow.y) / 100;
        draw();
        g.restore();
      };
      g.textAlign = "left";
      g.direction = m.rtl ? "rtl" : "ltr";
      let ty = y;
      const track = l.tracking * sizePx;

      for (const line of m.lines) {
        const scaled = line.map(t => ({ ...t, w: t.w * s }));
        const lw = lineWidth(scaled, spaceW);
        // each line is positioned inside the block according to the alignment
        let tx = x;
        if (m.align === "center") tx = x + (w - lw) / 2;
        else if (m.align === "right") tx = x + w - lw;
        // the browser reorders spans for a dir=rtl block; here it is done by
        // hand, so the first word of an Arabic line is placed at the right
        const seq = m.rtl ? [...scaled].reverse() : scaled;
        for (const t of seq) {
          g.fillStyle = grad ?? (t.accent ? l.color2 : l.color);
          if (track) {
            // draw glyph by glyph so tracking matches the measured width
            let gx = tx;
            for (const ch of t.text) {
              const at = gx;
              if (strokePx > 0) withShadow(() => g.strokeText(ch, at, ty));
              withShadow(() => g.fillText(ch, at, ty));
              gx += g.measureText(ch).width + track;
            }
          } else {
            if (strokePx > 0) withShadow(() => g.strokeText(t.text, tx, ty));
            withShadow(() => g.fillText(t.text, tx, ty));
          }
          tx += t.w + spaceW;
        }
        ty += sizePx * m.lh;
      }
      return;
    }
  }
}

export function renderPlacement(pl: Placement, o: RenderOpts): HTMLCanvasElement {
  const W = Math.round(pl.w * o.scale);
  const H = Math.round(pl.h * o.scale);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";

  if (o.fit === "contain") {
    g.fillStyle = o.padColor;
    g.fillRect(0, 0, W, H);
  }
  const r = coverRect(o.img.naturalWidth, o.img.naturalHeight, W, H, o.fit);
  g.drawImage(resampled(o.img, r.w, r.h), r.x, r.y, r.w, r.h);

  if (o.copy && o.design.copyOn) {
    const cache = o.images ?? new Map<string, HTMLImageElement>();
    for (const p of placeAll(pl, o.design, o.ctx)) drawLayer(g, p, pl, o, W, H, cache);
  }

  if (o.guides) {
    const f = safeF(pl);
    g.save();
    g.fillStyle = "rgba(255,84,80,.28)";
    if (pl.safe.t) g.fillRect(0, 0, W, f.t * H);
    if (pl.safe.b) g.fillRect(0, H - f.b * H, W, f.b * H);
    if (pl.safe.l) g.fillRect(0, f.t * H, f.l * W, H - (f.t + f.b) * H);
    if (pl.safe.r) g.fillRect(W - f.r * W, f.t * H, f.r * W, H - (f.t + f.b) * H);
    g.strokeStyle = "#BFFF00";
    g.lineWidth = Math.max(2, W * 0.004);
    g.setLineDash([W * 0.02, W * 0.014]);
    g.strokeRect(f.l * W, f.t * H, W - (f.l + f.r) * W, H - (f.t + f.b) * H);
    g.setLineDash([]);
    g.fillStyle = "#BFFF00";
    g.font = `700 ${Math.round(W * 0.028)}px 'Plus Jakarta Sans', sans-serif`;
    g.textAlign = "left";
    g.textBaseline = "top";
    g.fillText(
      `${pl.plat} ${pl.name} — safe ${Math.round(W - (f.l + f.r) * W)} × ${Math.round(H - (f.t + f.b) * H)}`,
      f.l * W + W * 0.012,
      f.t * H + W * 0.012
    );
    g.restore();
  }

  return c;
}

/* ============================================================
   ENCODING
   ============================================================ */

const bytesOfDataUrl = (url: string) => {
  const i = url.indexOf(",");
  const b64 = url.slice(i + 1);
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.round((b64.length * 3) / 4 - padding);
};

export interface Encoded {
  url: string;
  bytes: number;
  format: ExportFormat;
  quality: number | null;
}

/** JPEG onto an opaque backdrop; JPEG has no alpha and would go black. */
function flattened(canvas: HTMLCanvasElement, bg: string): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height;
  const g = out.getContext("2d")!;
  g.fillStyle = bg;
  g.fillRect(0, 0, out.width, out.height);
  g.drawImage(canvas, 0, 0);
  return out;
}

export function encode(canvas: HTMLCanvasElement, format: ExportFormat, quality: number, bg = "#000000"): Encoded {
  if (format === "image/png") {
    const url = canvas.toDataURL("image/png");
    return { url, bytes: bytesOfDataUrl(url), format, quality: null };
  }
  const target = format === "image/jpeg" ? flattened(canvas, bg) : canvas;
  const url = target.toDataURL(format, quality);
  return { url, bytes: bytesOfDataUrl(url), format, quality };
}

/**
 * Land under a platform's file-size cap at the best quality that fits.
 * A binary search over quality, not a guessed constant — the same creative can
 * be 400 KB or 4 MB depending on how much detail is in the photograph.
 */
export function encodeUnderCap(
  canvas: HTMLCanvasElement,
  maxBytes: number,
  preferred: ExportFormat,
  bg = "#000000"
): Encoded {
  const lossless = encode(canvas, "image/png", 1, bg);
  if (preferred === "image/png" && lossless.bytes <= maxBytes) return lossless;

  const format: ExportFormat = preferred === "image/png" ? "image/jpeg" : preferred;
  let best = encode(canvas, format, 0.95, bg);
  if (best.bytes <= maxBytes) return best;

  let lo = 0.4;
  let hi = 0.95;
  for (let i = 0; i < 7; i++) {
    const mid = (lo + hi) / 2;
    const attempt = encode(canvas, format, mid, bg);
    if (attempt.bytes <= maxBytes) {
      best = attempt;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return best.bytes <= maxBytes ? best : encode(canvas, format, 0.4, bg);
}

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export const EXT: Record<ExportFormat, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export function exportName(brand: string, pl: Placement, w: number, h: number, ext: string, guides: boolean) {
  return (
    [slug(brand) || "creative", slug(`${pl.plat}-${pl.name}`), `${w}x${h}`, guides ? "guides" : null]
      .filter(Boolean)
      .join("_") + `.${ext}`
  );
}

export const dataUrlToBlob = (url: string) => fetch(url).then(r => r.blob());

export const prettyBytes = (n: number) =>
  n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
