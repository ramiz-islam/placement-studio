/**
 * Canvas exporter. Renders a placement at native resolution, without the
 * platform chrome, using the same layout() geometry as the preview.
 */

import { FONT, isRTL, type Design, type Fit, type Placement } from "./core";
import { coverRect, layout, measure, rgba, safeF, scrimBox, wrapLines } from "./geometry";

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

export function renderPlacement(pl: Placement, o: RenderOpts): HTMLCanvasElement {
  const W = Math.round(pl.w * o.scale);
  const H = Math.round(pl.h * o.scale);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  g.imageSmoothingQuality = "high";

  if (o.fit === "contain") {
    g.fillStyle = o.padColor;
    g.fillRect(0, 0, W, H);
  }
  const r = coverRect(o.img.naturalWidth, o.img.naturalHeight, W, H, o.fit);
  g.drawImage(o.img, r.x, r.y, r.w, r.h);

  const d = o.design;
  if (o.copy) {
    const logoAspect = o.logo ? o.logo.naturalHeight / o.logo.naturalWidth : 0.3;
    const L = layout(pl, d, logoAspect);
    const rtl = isRTL(d.lang);

    if (o.logo) {
      const lw = L.logo.w * W;
      const lh = lw * (o.logo.naturalHeight / o.logo.naturalWidth);
      g.drawImage(o.logo, L.logo.x * W, L.logo.y * H, lw, lh);
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
    g.font = `700 ${Math.round(W * 0.028)}px "Plus Jakarta Sans", sans-serif`;
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

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export function exportName(brand: string, pl: Placement, w: number, h: number, ext: string, guides: boolean) {
  return (
    [slug(brand) || "creative", slug(`${pl.plat}-${pl.name}`), `${w}x${h}`, guides ? "guides" : null]
      .filter(Boolean)
      .join("_") + `.${ext}`
  );
}

export const dataUrlToBlob = (url: string) => fetch(url).then(r => r.blob());
