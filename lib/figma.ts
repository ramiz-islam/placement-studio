/**
 * Figma import — the mapping from Figma's node tree to our layers.
 *
 * Pure and server-safe: no DOM, no canvas. The route fetches the tree and the
 * rendered images; this decides what each node becomes. Kept separate from the
 * route so the rules can be read, argued with and tested without a token.
 *
 * The rules, stated once:
 *  - The frame you link to is the canvas. Its children are read bottom to top,
 *    which is the order Figma lists them.
 *  - The bottom-most child that covers at least 90% of the frame is rendered
 *    and becomes the artwork. Everything above it becomes a layer.
 *  - TEXT becomes editable text with Figma's size, colour and alignment.
 *  - A rectangle or ellipse with only solid fills becomes a shape.
 *  - Frames, groups and sections are walked into, and their members share a
 *    group id so they still move as one.
 *  - Everything else — vectors, icons, instances, anything with an image fill —
 *    is rendered by Figma and imported as an image layer at its own bounds.
 *  - Hidden text is imported switched off; other hidden nodes are skipped,
 *    since rendering images nobody can see costs API calls for nothing.
 */

import { shapeLayer, textLayer, type Layer, type NewLayerDefaults } from "./layers";

export interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a?: number;
}
export interface FigmaPaint {
  type: string;
  visible?: boolean;
  opacity?: number;
  color?: FigmaColor;
  imageRef?: string;
}
export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  opacity?: number;
  children?: FigmaNode[];
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number } | null;
  /** the node's own size before rotation; the bounding box is its rotated extent */
  size?: { x: number; y: number };
  /** degrees, counter-clockwise, as Figma reports it */
  rotation?: number;
  fills?: FigmaPaint[];
  characters?: string;
  /** per-character style ids, parallel to `characters`; 0 means the node's own style */
  characterStyleOverrides?: number[];
  styleOverrideTable?: Record<string, { fills?: FigmaPaint[] }>;
  style?: {
    fontSize?: number;
    fontFamily?: string;
    fontWeight?: number;
    textAlignHorizontal?: string;
    lineHeightPercentFontSize?: number;
    letterSpacing?: number;
  };
  cornerRadius?: number;
}

export interface FigmaBuilt {
  creative: string | null;
  layers: Layer[];
  notes: string[];
}

export interface FigmaPlan {
  width: number;
  height: number;
  /** node ids the route must render before building; the first may be the background */
  needImages: string[];
  backgroundId: string | null;
  /** the frame's own image fill, when that is the background — fetched by imageRef, not rendered */
  backgroundRef: string | null;
  /** the frame's own solid fill, when that is the background — the client paints it */
  backgroundColor: string | null;
  build(images: Record<string, string>, refImages?: Record<string, string>): FigmaBuilt;
}

const COVERS = 0.9;

/** figma.com/file/KEY/… or figma.com/design/KEY/…, with an optional ?node-id=1-23 */
export function parseFigmaUrl(input: string): { fileKey: string; nodeId: string | null } | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (!/(^|\.)figma\.com$/.test(u.hostname)) return null;
  const m = u.pathname.match(/^\/(?:file|design|proto|board)\/([A-Za-z0-9]+)/);
  if (!m) return null;
  const raw = u.searchParams.get("node-id");
  // the URL writes 12-34; the API wants 12:34
  const nodeId = raw ? decodeURIComponent(raw).replace(/-/g, ":") : null;
  return { fileKey: m[1], nodeId };
}

function hex(c: FigmaColor | undefined, fallback: string): string {
  if (!c) return fallback;
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n * 255))).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`.toUpperCase();
}

function solidFill(node: FigmaNode): FigmaPaint | null {
  const fills = (node.fills ?? []).filter(f => f.visible !== false);
  if (!fills.length || fills.some(f => f.type !== "SOLID")) return null;
  return fills[fills.length - 1];
}

const hasImageFill = (node: FigmaNode) => (node.fills ?? []).some(f => f.visible !== false && f.type === "IMAGE");

const WALK_INTO = new Set(["FRAME", "GROUP", "SECTION"]);

/**
 * Figma colours words by per-character style overrides. This app colours them
 * with [brackets] and a second colour. Runs whose fill differs from the node's
 * own become bracketed; the first such colour is the second colour. More than
 * one accent colour collapses to the first — a limit, stated here.
 */
function twoTone(node: FigmaNode, base: string): { text: string; color2: string | null } {
  const chars = [...(node.characters ?? "")];
  const ov = node.characterStyleOverrides;
  const table = node.styleOverrideTable;
  if (!ov || !table || !chars.length) return { text: (node.characters ?? "").trim(), color2: null };
  const colourOf = (id: number): string | null => {
    if (!id) return null;
    const fills = (table[String(id)]?.fills ?? []).filter(p => p.visible !== false && p.type === "SOLID");
    return fills.length ? hex(fills[fills.length - 1].color, base) : null;
  };
  let color2: string | null = null;
  let out = "";
  let open = false;
  for (let i = 0; i < chars.length; i++) {
    const c = colourOf(ov[i] ?? 0);
    const accent = Boolean(c && c !== base);
    if (accent && !color2) color2 = c;
    const on = accent && c === color2;
    if (on && !open && chars[i] !== " ") {
      out += "[";
      open = true;
    } else if (!on && open) {
      out += "]";
      open = false;
    }
    out += chars[i];
  }
  if (open) out += "]";
  // brackets never straddle whitespace; tidy any that closed after a space
  out = out.replace(/\s+\]/g, "] ").replace(/\[\s+/g, " [");
  return { text: out.trim(), color2 };
}

export function planFigmaImport(root: FigmaNode, d: NewLayerDefaults): FigmaPlan {
  const rb = root.absoluteBoundingBox;
  if (!rb || rb.width <= 0 || rb.height <= 0) {
    throw new Error(
      root.type === "CANVAS" || root.type === "DOCUMENT"
        ? "That link points at a whole page. In Figma, select the frame you want and use Share → Copy link so the link carries the frame."
        : "That node has no size Figma can report. Link to a frame instead."
    );
  }
  const W = rb.width;
  const H = rb.height;
  const frac = (n: FigmaNode) => {
    const b = n.absoluteBoundingBox;
    if (!b) return null;
    return { x: (b.x - rb.x) / W, y: (b.y - rb.y) / H, w: b.width / W, h: b.height / H };
  };
  const coverage = (f: { x: number; y: number; w: number; h: number }) => {
    const x0 = Math.max(0, f.x);
    const y0 = Math.max(0, f.y);
    const x1 = Math.min(1, f.x + f.w);
    const y1 = Math.min(1, f.y + f.h);
    return x1 <= x0 || y1 <= y0 ? 0 : (x1 - x0) * (y1 - y0);
  };

  const needImages: string[] = [];
  const steps: ((images: Record<string, string>, layers: Layer[], notes: string[]) => void)[] = [];
  let backgroundId: string | null = null;
  let skippedHidden = 0;
  let textCount = 0;
  let shapeCount = 0;
  let imageCount = 0;

  const children = root.children ?? [];

  // the background: the bottom-most child covering the frame, rendered as-is
  if (children.length) {
    const first = children[0];
    const f = frac(first);
    if (f && first.visible !== false && coverage(f) >= COVERS && !WALK_INTO.has(first.type)) {
      backgroundId = first.id;
      needImages.push(first.id);
    }
  }

  /*
   * Otherwise the frame's own fill is the background — a photo set as the
   * frame's image fill is the most common way a story is built. Rendering the
   * whole frame instead would bake every layer into the artwork and then draw
   * them again on top: the ghosted-double look. The image fill is fetched by
   * its imageRef; a solid fill is painted client-side.
   */
  let backgroundRef: string | null = null;
  let backgroundColor: string | null = null;
  if (!backgroundId) {
    const fills = (root.fills ?? []).filter(p => p.visible !== false);
    const img = fills.find(p => p.type === "IMAGE" && p.imageRef);
    const solid = fills.find(p => p.type === "SOLID");
    if (img) backgroundRef = img.imageRef!;
    else if (solid) backgroundColor = hex(solid.color, "#FFFFFF");
  }

  const walk = (nodes: FigmaNode[], group: string | null, parentHidden: boolean) => {
    for (const node of nodes) {
      if (node.id === backgroundId) continue;
      const hidden = parentHidden || node.visible === false;
      const f = frac(node);
      if (!f || f.w <= 0 || f.h <= 0) continue;

      if (WALK_INTO.has(node.type) && node.children?.length && !hasImageFill(node)) {
        const gid = `g-${Math.random().toString(36).slice(2, 9)}`;
        // a frame with a solid fill is a shape as well as a container
        const fill = solidFill(node);
        if (fill && !hidden) {
          shapeCount++;
          steps.push((_i, layers) =>
            layers.push(
              shapeLayer({
                name: node.name || "Frame",
                shape: "rect",
                pos: { x: f.x, y: f.y },
                w: f.w * 100,
                h: f.h * 100,
                fill: {
                  color: hex(fill.color, "#141652"),
                  color2: null,
                  angle: 90,
                  opacity: Math.round((fill.opacity ?? 1) * (node.opacity ?? 1) * 100),
                },
                radius: node.cornerRadius ? (node.cornerRadius / Math.min(f.w * W, f.h * H)) * 100 : 0,
                group: gid,
              })
            )
          );
        }
        walk(node.children, gid, hidden);
        continue;
      }

      if (node.type === "TEXT") {
        const st = node.style ?? {};
        const fill = solidFill(node);
        const align =
          st.textAlignHorizontal === "CENTER" ? "center" : st.textAlignHorizontal === "RIGHT" ? "right" : "left";
        const fontPx = st.fontSize ?? Math.max(10, f.h * H * 0.8);
        const { text, color2 } = twoTone(node, hex(fill?.color, d.color));
        textCount++;
        steps.push((_i, layers) =>
          layers.push(
            textLayer(d, {
              name: node.name || "Text",
              text,
              pos: { x: f.x, y: f.y },
              size: Math.max(0.5, Math.min(30, (fontPx / W) * 100)),
              blockW: Math.max(8, Math.min(100, f.w * 100 * 1.04)),
              color: hex(fill?.color, d.color),
              ...(color2 ? { color2 } : null),
              align,
              on: !hidden,
              group,
            })
          )
        );
        continue;
      }

      if (hidden) {
        skippedHidden++;
        continue;
      }

      const fill = solidFill(node);
      if ((node.type === "RECTANGLE" || node.type === "ELLIPSE") && fill) {
        shapeCount++;
        /*
         * The bounding box is the rotated extent. A tilted rectangle imported at
         * that box, unrotated, is a different shape — the wedge in the reference
         * ad came in as a squat block. Use the node's own size and turn it.
         */
        const rot = node.rotation ?? 0;
        const turned = Math.abs(rot) > 0.5 && node.size;
        const ow = turned ? node.size!.x / W : f.w;
        const oh = turned ? node.size!.y / H : f.h;
        const cx = f.x + f.w / 2;
        const cy = f.y + f.h / 2;
        steps.push((_i, layers) =>
          layers.push(
            shapeLayer({
              name: node.name || node.type.toLowerCase(),
              shape: node.type === "ELLIPSE" ? "ellipse" : "rect",
              pos: { x: cx - ow / 2, y: cy - oh / 2 },
              w: ow * 100,
              h: oh * 100,
              // Figma turns counter-clockwise, this app clockwise
              rotation: turned ? -rot : 0,
              fill: {
                color: hex(fill.color, "#141652"),
                color2: null,
                angle: 90,
                opacity: Math.round((fill.opacity ?? 1) * (node.opacity ?? 1) * 100),
              },
              radius: node.cornerRadius ? (node.cornerRadius / Math.min(f.w * W, f.h * H)) * 100 : 0,
              group,
            })
          )
        );
        continue;
      }

      // everything else is rendered by Figma and placed as a picture
      imageCount++;
      needImages.push(node.id);
      steps.push((images, layers, notes) => {
        const src = images[node.id];
        if (!src) {
          notes.push(`"${node.name}" could not be rendered by Figma and was skipped.`);
          return;
        }
        layers.push(
          shapeLayer({
            name: node.name || "Image",
            shape: "rect",
            src,
            srcFit: "contain",
            pos: { x: f.x, y: f.y },
            w: f.w * 100,
            h: f.h * 100,
            fill: { color: "#000000", color2: null, angle: 90, opacity: 0 },
            radius: 0,
            group,
          })
        );
      });
    }
  };
  walk(children, null, false);

  // nothing covers the frame and it has no fill of its own: render the frame,
  // and say plainly that the layers will double up
  if (!backgroundId && !backgroundRef && !backgroundColor) needImages.push(root.id);

  return {
    width: W,
    height: H,
    needImages,
    backgroundId,
    backgroundRef,
    backgroundColor,
    build(images, refImages = {}) {
      const layers: Layer[] = [];
      const notes: string[] = [];
      let creative: string | null = null;
      if (backgroundId) {
        creative = images[backgroundId] ?? null;
        const bg = children.find(c => c.id === backgroundId);
        notes.push(`"${bg?.name ?? "the bottom layer"}" covers the frame and became the artwork.`);
      } else if (backgroundRef) {
        creative = refImages[backgroundRef] ?? null;
        notes.push(
          creative
            ? "The frame's own image fill became the artwork."
            : "The frame's image fill could not be fetched from Figma; the layers were imported without it."
        );
      } else if (backgroundColor) {
        notes.push(`The frame's ${backgroundColor} fill became the artwork.`);
      } else {
        creative = images[root.id] ?? null;
        notes.push(
          "Nothing covered the frame and it has no fill, so the frame itself is the artwork. The layers are imported too, so anything the frame already shows will appear twice — hide or delete the duplicates."
        );
      }
      for (const step of steps) step(images, layers, notes);
      notes.push(
        `${imageCount} image ${imageCount === 1 ? "layer" : "layers"}, ${shapeCount} ${
          shapeCount === 1 ? "shape" : "shapes"
        }, ${textCount} text ${textCount === 1 ? "layer" : "layers"}${
          skippedHidden ? `, ${skippedHidden} hidden skipped` : ""
        }, from a ${Math.round(W)} × ${Math.round(H)} frame.`
      );
      return { creative, layers, notes };
    },
  };
}
