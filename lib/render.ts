/**
 * Canvas exporter. Renders a placement at native resolution, without the
 * platform chrome, using the same layout() geometry as the preview.
 *
 * On "high quality" for ad upload — what actually matters, in order:
 *  1. Exact pixel dimensions for the placement. Platforms resample anything
 *     else, and their resampler is worse than ours.
 *  2. No upscaling of the source. Copy and logo are drawn as vectors/text at
 *     full output resolution, so they stay crisp; only the photograph can
 *     soften, and we warn when it would.
 *  3. Progressive downsampling. A single drawImage from a much larger source
 *     aliases; halving in steps does not.
 *  4. Landing under the platform's file-size cap without visible artefacts,
 *     which is a quality search, not a fixed quality number.
 *  5. sRGB, 8-bit. Every ad platform re-encodes to sRGB — canvas already
 *     normalises to it, and there is no HDR ad format to target.
 */

import { FONT, isRTL, type Design, type Fit, type Placement } from "./core";
import { coverRect, layout, logoScrimBox, measure, rgba, safeF, scrimBox, wrapLines } from "./geometry";

export type ExportFormat = "image/png" | "image/jpeg" | "image/webp";

export interface RenderOpts {
  scale: number;
  copy: boolean;
  guides: boolean;
  fit: Fit;
  padColor: string;
  img: HTMLImageElement;
  logo: HTMLImageElement | null;
  design: Design;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
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
  const r = coverRect(img.naturalWidth, img.naturalHeight, pl.w * scale, pl.h * scale, fit);
  return r.s;
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

  const d = o.design;
  if (o.copy) {
    const logoAspect = o.logo ? o.logo.naturalHeight / o.logo.naturalWidth : 0.3;
    const L = layout(pl, d, logoAspect);
    const rtl = isRTL(d.lang);

    if (o.logo) {
      const lw = L.logo.w * W;
      const lh = lw * (o.logo.naturalHeight / o.logo.naturalWidth);
      const lx = L.logo.x * W;
      const ly = L.logo.y * H;

      if (d.logoScrim) {
        const lsb = logoScrimBox(pl, L, d);
        const pad = lsb.pad * o.scale;
        g.fillStyle = rgba(d.logoScrimColor, d.logoScrimOpacity);
        roundRect(g, lx - pad, ly - pad, lw + pad * 2, lh + pad * 2, lsb.radius * o.scale);
        g.fill();
      }
      g.drawImage(resampled(o.logo, lw, lh), lx, ly, lw, lh);
    }

    if (d.copyOn && (d.head || d.brand)) {
      const F = L.head.font;
      const hx = L.head.x * W;
      const hy = L.head.y * H;
      const hw = L.head.w * W;
      const headPx = L.head.headPx * o.scale;
      const brandPx = L.head.brandPx * o.scale;

      if (d.scrim) {
        const sb = scrimBox(L, d);
        const padX = sb.padX * o.scale;
        const padY = sb.padY * o.scale;
        g.fillStyle = rgba(d.scrimColor, d.scrimOpacity);
        roundRect(g, hx - padX, hy - padY, hw + padX * 2, L.head.h * H + padY * 2, sb.radius * o.scale);
        g.fill();
      }

      g.textAlign = rtl ? "right" : "left";
      g.textBaseline = "top";
      g.direction = rtl ? "rtl" : "ltr";
      const ax = rtl ? hx + hw : hx;
      let y = hy;

      if (d.brand) {
        g.fillStyle = d.headColor;
        g.font = `700 ${brandPx}px ${F.css}`;
        // letter-spaced eyebrow in Latin; Arabic must not be split
        const tracked = rtl ? d.brand : d.brand.toUpperCase().split("").join(" ");
        g.fillText(tracked, ax, y);
        y += brandPx * 1.5 + headPx * 0.22;
      }
      if (d.head) {
        g.fillStyle = d.headColor;
        g.font = `${F.weight} ${headPx}px ${F.css}`;
        for (const line of wrapLines(d.head, F.css, F.weight, headPx, hw)) {
          g.fillText(line, ax, y);
          y += headPx * L.head.lh;
        }
      }
    }

    if (d.copyOn && d.cta) {
      const F = FONT(d.headFont);
      const ctaPx = L.cta.ctaPx * o.scale;
      const bw = measure(d.cta, F.css, 700, ctaPx) + ctaPx * 2.2;
      const bh = ctaPx * 2.5;
      const bx = L.cta.x * W;
      const by = L.cta.y * H;
      g.fillStyle = d.ctaBg;
      roundRect(g, bx, by, bw, bh, bh / 2);
      g.fill();
      g.fillStyle = d.ctaInk;
      g.font = `700 ${ctaPx}px ${F.css}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.direction = isRTL(d.lang) ? "rtl" : "ltr";
      g.fillText(d.cta, bx + bw / 2, by + bh / 2 + ctaPx * 0.04);
    }
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

export function encode(
  canvas: HTMLCanvasElement,
  format: ExportFormat,
  quality: number,
  bg = "#000000"
): Encoded {
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
 * A binary search over quality, not a guessed constant — the same creative
 * can be 400 KB or 4 MB depending on how much detail is in the photograph.
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
  // still over at the floor: hand back the smallest we managed and let the UI say so
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
