/**
 * Photoshop import.
 *
 * A designer's PSD is the real source: the artwork, the copy and where each
 * piece sits. Reading it in as layers — instead of a flattened export that
 * then has to be rebuilt by hand — is what makes the tool a step in the
 * existing workflow rather than a second place the design has to be redone.
 *
 * Parsing happens in the browser with ag-psd. Nothing is uploaded.
 *
 * What becomes the artwork, stated once so it can be argued with: starting
 * from the bottom, every consecutive top-level raster layer that covers the
 * canvas is flattened into the creative — a colour fill, a texture and a
 * photograph stacked at the bottom of a real file are one background, not
 * three layers. The first layer that does not cover the canvas ends the
 * background, and everything from there up becomes a layer. If nothing covers
 * the canvas, the composite is used and every layer is still imported, which
 * doubles up whatever the composite already shows — the import says so.
 */

import { readPsd, type Layer as PsdLayer, type Psd } from "ag-psd";
import { shapeLayer, textLayer, type Layer, type NewLayerDefaults } from "./layers";

export interface PsdImport {
  width: number;
  height: number;
  /** the artwork, as a data URL, or null when the file had nothing to use */
  creative: string | null;
  /** everything that became a layer, bottom to top */
  layers: Layer[];
  /** what the import decided and why, for the toast and the console */
  notes: string[];
}

const COVERS = 0.9;

function toDataUrl(canvas: HTMLCanvasElement | undefined): string | null {
  if (!canvas || !canvas.width || !canvas.height) return null;
  try {
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

/** True when a layer's pixels are all transparent (sampled, so a 4k layer costs little). */
function isBlank(canvas: HTMLCanvasElement | undefined): boolean {
  if (!canvas || !canvas.width || !canvas.height) return true;
  try {
    const g = canvas.getContext("2d", { willReadFrequently: true });
    if (!g) return false;
    const d = g.getImageData(0, 0, canvas.width, canvas.height).data;
    const step = Math.max(1, Math.floor(d.length / 4 / 20000)) * 4;
    for (let i = 3; i < d.length; i += step) if (d[i] > 8) return false;
    return true;
  } catch {
    return false;
  }
}

function rgbToHex(c: { r: number; g: number; b: number } | undefined, fallback: string): string {
  if (!c) return fallback;
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`.toUpperCase();
}

interface Bounds {
  left: number;
  top: number;
  w: number;
  h: number;
}

function bounds(layer: PsdLayer): Bounds {
  const left = layer.left ?? 0;
  const top = layer.top ?? 0;
  return { left, top, w: Math.max(0, (layer.right ?? left) - left), h: Math.max(0, (layer.bottom ?? top) - top) };
}

/** How much of the canvas a layer's bounds cover, counting only the part inside it. */
function coverage(b: Bounds, W: number, H: number): number {
  const x0 = Math.max(0, b.left);
  const y0 = Math.max(0, b.top);
  const x1 = Math.min(W, b.left + b.w);
  const y1 = Math.min(H, b.top + b.h);
  if (x1 <= x0 || y1 <= y0) return 0;
  return ((x1 - x0) * (y1 - y0)) / (W * H);
}

export async function importPsd(file: File, d: NewLayerDefaults): Promise<PsdImport> {
  const buf = await file.arrayBuffer();
  const psd: Psd = readPsd(buf, { skipThumbnail: true, skipLinkedFilesData: true });
  const W = psd.width;
  const H = psd.height;
  const notes: string[] = [];
  const layers: Layer[] = [];
  let rasterCount = 0;
  let textCount = 0;
  let hiddenCount = 0;

  /* ---------- the background: consecutive covering layers from the bottom ---------- */

  const top = psd.children ?? [];
  let bgEnd = 0;
  const bgNames: string[] = [];
  while (bgEnd < top.length) {
    const n = top[bgEnd];
    if (n.children || n.text || n.hidden || !n.canvas) break;
    if (coverage(bounds(n), W, H) < COVERS) break;
    bgNames.push(n.name?.trim() || `Layer ${bgEnd + 1}`);
    bgEnd++;
  }

  let creative: string | null = null;
  if (bgEnd > 0) {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d")!;
    for (let i = 0; i < bgEnd; i++) {
      const n = top[i];
      const b = bounds(n);
      g.globalAlpha = n.opacity ?? 1;
      g.drawImage(n.canvas!, b.left, b.top);
    }
    g.globalAlpha = 1;
    creative = toDataUrl(c);
    notes.push(
      bgEnd === 1
        ? `"${bgNames[0]}" covers the canvas and became the artwork.`
        : `${bgEnd} layers at the bottom cover the canvas and were flattened into the artwork: ${bgNames
            .map(s => `"${s}"`)
            .join(", ")}.`
    );
  }

  /* ---------- everything above it becomes a layer ---------- */

  /*
   * ag-psd lists children bottom-first, the same way Photoshop's layers panel
   * reads from the bottom, so a plain walk visits paint order. Groups are
   * flattened but their members share a group id, so they still move as one —
   * and a hidden group hides everything inside it, which the children do not
   * record themselves.
   */
  const walk = (nodes: PsdLayer[], group: string | null, parentHidden: boolean) => {
    for (const node of nodes) {
      const hidden = parentHidden || Boolean(node.hidden);
      if (node.children) {
        const gid = `g-${Math.random().toString(36).slice(2, 9)}`;
        walk(node.children, gid, hidden);
        continue;
      }
      const b = bounds(node);
      if (b.w <= 0 || b.h <= 0) continue;
      const name = node.name?.trim() || (node.text ? "Text" : "Layer");
      const on = !hidden;
      if (!on) hiddenCount++;
      const frac = { x: b.left / W, y: b.top / H, w: b.w / W, h: b.h / H };

      if (node.text) {
        const style = node.text.style ?? {};
        const para = node.text.paragraphStyle ?? {};
        const text = node.text.text.replace(/\r/g, "\n").trim();
        /*
         * Photoshop stores the point size before the layer's transform, so a
         * headline reads as 187pt in a 628px-tall document. The transform's
         * vertical scale gives the size that actually landed on the canvas.
         * Without a transform, fall back to the glyph bounds over the explicit
         * line count — which under-counts paragraphs Photoshop wrapped itself,
         * so it is the fallback and not the rule.
         */
        const tf = node.text.transform;
        const scale = tf && tf.length >= 4 ? Math.hypot(tf[2], tf[3]) : 0;
        const explicitLines = Math.max(1, text.split("\n").length);
        const renderedPx =
          style.fontSize && scale > 0 ? style.fontSize * scale : b.h / explicitLines / 1.18;
        const align =
          para.justification === "center" ? "center" : para.justification === "right" ? "right" : "left";
        layers.push(
          textLayer(d, {
            name,
            text,
            pos: { x: frac.x, y: frac.y },
            size: Math.max(0.5, Math.min(30, (renderedPx / W) * 100)),
            // wider than the glyphs: our fallback font is not the file's, and a
            // block cut to the original's width rewraps the last word
            blockW: Math.max(8, Math.min(100, frac.w * 100 * 1.2)),
            color: rgbToHex(style.fillColor as { r: number; g: number; b: number } | undefined, d.color),
            align,
            on,
            group,
          })
        );
        textCount++;
        continue;
      }

      // an empty raster — a mask holder, a cleared layer — imports as an invisible
      // box the audit then flags; there is nothing in it to keep
      if (isBlank(node.canvas)) continue;
      const src = toDataUrl(node.canvas);
      if (!src) continue;
      layers.push(
        shapeLayer({
          name,
          shape: "rect",
          src,
          srcFit: "contain",
          pos: { x: frac.x, y: frac.y },
          w: Math.max(0.5, frac.w * 100),
          h: Math.max(0.2, frac.h * 100),
          fill: { color: "#000000", color2: null, angle: 90, opacity: 0 },
          radius: 0,
          on,
          group,
        })
      );
      rasterCount++;
    }
  };
  walk(top.slice(bgEnd), null, false);

  if (!creative) {
    creative = toDataUrl(psd.canvas);
    notes.push(
      creative
        ? "No layer covered the canvas, so the flattened composite is the artwork. The layers are imported too, so anything the composite already shows will appear twice — hide or delete the duplicates."
        : "The file had no artwork this tool could use; only the layers were imported."
    );
  }

  notes.push(
    `${rasterCount} image ${rasterCount === 1 ? "layer" : "layers"}, ${textCount} text ${
      textCount === 1 ? "layer" : "layers"
    }${hiddenCount ? `, ${hiddenCount} hidden` : ""}, from a ${W} × ${H} document.`
  );

  return { width: W, height: H, creative, layers, notes };
}
