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
  fills?: FigmaPaint[];
  characters?: string;
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
  build(images: Record<string, string>): FigmaBuilt;
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

export function planFigmaImport(root: FigmaNode, d: NewLayerDefaults): FigmaPlan {
  const rb = root.absoluteBoundingBox;
  if (!rb || rb.width <= 0 || rb.height <= 0) throw new Error("That frame has no size Figma can report.");
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
        textCount++;
        steps.push((_i, layers) =>
          layers.push(
            textLayer(d, {
              name: node.name || "Text",
              text: (node.characters ?? "").trim(),
              pos: { x: f.x, y: f.y },
              size: Math.max(0.5, Math.min(30, (fontPx / W) * 100)),
              blockW: Math.max(8, Math.min(100, f.w * 100 * 1.04)),
              color: hex(fill?.color, d.color),
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
        steps.push((_i, layers) =>
          layers.push(
            shapeLayer({
              name: node.name || node.type.toLowerCase(),
              shape: node.type === "ELLIPSE" ? "ellipse" : "rect",
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

  // no covering child: render the frame itself, and say what that means
  if (!backgroundId) needImages.push(root.id);

  return {
    width: W,
    height: H,
    needImages,
    backgroundId,
    build(images) {
      const layers: Layer[] = [];
      const notes: string[] = [];
      let creative: string | null = null;
      if (backgroundId) {
        creative = images[backgroundId] ?? null;
        const bg = children.find(c => c.id === backgroundId);
        notes.push(`"${bg?.name ?? "the bottom layer"}" covers the frame and became the artwork.`);
      } else {
        creative = images[root.id] ?? null;
        notes.push(
          "No layer covered the frame, so the frame itself is the artwork. The layers are imported too, so anything the frame already shows will appear twice — hide or delete the duplicates."
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
