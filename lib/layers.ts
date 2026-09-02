/**
 * The layer model.
 *
 * Everything on the frame is a layer in one ordered list: text, CTA, logo,
 * shapes, icons. First in the array paints first, so the list reads
 * back-to-front the way a design tool's layer panel does.
 *
 * Two rules make the rest of the app simple:
 *  · Every position and size is a fraction of the placement canvas, never a
 *    screen pixel. That is what lets one layout be judged against 23 frames
 *    and exported at any resolution.
 *  · A layer's paint definition lives here and nowhere else, so the DOM
 *    preview and the canvas exporter cannot drift apart.
 */

import type { Pt } from "./core";

export type LayerKind = "text" | "cta" | "logo" | "shape" | "icon" | "screen";

/**
 * What direct manipulation on the frame can override for a single placement.
 * Deliberately narrow: these are the properties you change by dragging, and
 * nothing else, so a per-placement tweak can never fork the styling.
 */
export interface LayerPatch {
  pos?: Pt;
  /** per-placement corner pinning for a screen layer */
  corners?: [Pt, Pt, Pt, Pt];
  /** width, % of frame — shapes, logos, icons */
  w?: number;
  /** height, % of frame — shapes */
  h?: number;
  /** type size, % of frame — text and buttons */
  size?: number;
  /** text block width, % of frame */
  blockW?: number;
  /** degrees */
  rotation?: number;
}

/** Solid when `color2` is null, otherwise a linear gradient at `angle`. */
export interface Fill {
  color: string;
  color2: string | null;
  /** degrees; 0 = left to right, 90 = top to bottom */
  angle: number;
  /** 0-100 */
  opacity: number;
}

export const solid = (color: string, opacity = 100): Fill => ({ color, color2: null, angle: 90, opacity });

/** A plate behind a layer. `pad` and `radius` are percentages of the layer's own width. */
export interface Plate {
  on: boolean;
  fill: Fill;
  pad: number;
  radius: number;
}

export const noPlate = (color = "#07080E", opacity = 50): Plate => ({
  on: false,
  fill: solid(color, opacity),
  pad: 50,
  radius: 18,
});

interface Base {
  id: string;
  kind: LayerKind;
  /** shown in the layer list; the user can rename it */
  name: string;
  on: boolean;
  /** top-left, as a fraction of the placement canvas */
  pos: Pt;
  /**
   * Degrees clockwise about the layer's own centre.
   *
   * On Base rather than on the two shape types, because "rotate the thing I
   * selected" is how every paint program has worked for thirty years, and a
   * headline you cannot tilt is a headline you have to rebuild as an image.
   */
  rotation?: number;
  /**
   * Layers sharing a group id behave as one object: selecting any member
   * selects them all, so they drag, align and nudge together. This is what
   * "merge" means for layers that cannot be flattened into each other — a logo
   * on a band, an icon on a shape — where you want one thing to move but still
   * want to restyle either half later.
   */
  group?: string | null;
}

export type Align = "left" | "center" | "right";

export interface TextLayer extends Base {
  kind: "text";
  /** where each line sits inside the text block */
  align: Align;
  /** words in [square brackets] take `color2` */
  text: string;
  font: string;
  /** % of frame width */
  size: number;
  /** text block width, % of frame width */
  blockW: number;
  color: string;
  color2: string;
  /** null follows the typeface's own line height */
  lineHeight: number | null;
  /** letter-spacing in em */
  tracking: number;
  upper: boolean;
  scrim: Plate;
  /**
   * A gradient across the type, from `color` to `grad.to`. Off by default, and
   * mutually exclusive with the two-tone word colouring: a per-word colour is
   * invisible once the whole block is painted with one gradient.
   */
  grad: { on: boolean; to: string; angle: number };
  /**
   * Stacked glyphs running down the frame, each one upright — what a
   * spreadsheet calls "vertical text", as opposed to a rotated block.
   *
   * Distinct from `rotation`: rotating a headline 90° turns the whole line on
   * its side, so you read it with your head tilted. This keeps every letter the
   * right way up and stacks them, which is what you want down the edge of a
   * story frame.
   */
  vertical?: boolean;
}

export interface CtaLayer extends Base {
  kind: "cta";
  text: string;
  font: string;
  size: number;
  bg: Fill;
  ink: string;
  /** % of the pill's height; 50 is a full pill */
  radius: number;
}

export interface LogoLayer extends Base {
  kind: "logo";
  /** % of frame width */
  w: number;
  /** a plate that hugs the logo */
  plate: Plate;
  /** a full-width strip across the frame, behind the logo, that moves with it */
  band: { on: boolean; fill: Fill; pad: number };
}

/**
 * `chevron` is the brand block: a rectangle that comes to a point on one edge,
 * the shape CarSwitch ads use to carve a clean field for the logo and headline
 * out of a photograph. Rotate it to point the other way.
 */
export type ShapeKind = "rect" | "ellipse" | "triangle" | "chevron" | "band" | "line";

/** The chevron outline, as fractions of the shape's own box. */
export const CHEVRON: [number, number][] = [
  [0, 0],
  [0.62, 0],
  [1, 0.5],
  [0.62, 1],
  [0, 1],
];

export interface ShapeLayer extends Base {
  kind: "shape";
  shape: ShapeKind;
  /** % of frame width / height */
  w: number;
  h: number;
  fill: Fill;
  /** % of the shorter side */
  radius: number;
  /**
   * An uploaded image, clipped to the shape. With this set the shape becomes a
   * picture frame — a logo lockup, a badge, a cut-out — instead of flat colour.
   */
  src: string | null;
  /**
   * How `src` fills the box. `cover` crops it to the shape, which is what a
   * picture frame wants. `contain` keeps the whole image and its transparency,
   * which is what a cut-out subject wants: the point of a cut-out is the shape
   * of the thing, so cropping it defeats the purpose.
   */
  srcFit?: "cover" | "contain";
}

/**
 * An app screenshot mapped onto the screen of a phone in the artwork.
 *
 * The most common shot in app advertising, and the one thing position, size and
 * rotation cannot do: a phone held at an angle shows its screen as a trapezium.
 * So the four corners are yours to place, and the screenshot is warped to meet
 * them.
 */
export interface ScreenLayer extends Base {
  kind: "screen";
  src: string | null;
  /** % of frame width and height — the box the corners are measured inside */
  w: number;
  h: number;
  /**
   * Top-left, top-right, bottom-right, bottom-left, each a fraction of the
   * layer's own box. Kept box-relative so dragging and resizing the layer move
   * the whole quad, and only the corner handles change its shape.
   */
  corners: [Pt, Pt, Pt, Pt];
  /** rounded screen corners, % of the shorter side */
  radius: number;
  /** a hint of screen glass, 0 turns it off */
  gloss: number;
}

export interface IconLayer extends Base {
  kind: "icon";
  /** a built-in id from ICONS, or "custom" when `src` is set */
  icon: string;
  src: string | null;
  /** % of frame width */
  w: number;
  color: string;
  /** the same plate the text and logo layers get */
  scrim: Plate;
}

export type Layer = TextLayer | CtaLayer | LogoLayer | ShapeLayer | IconLayer | ScreenLayer;

/* ============================================================
   BUILT-IN ICONS
   One path string per icon in a 24×24 box, so the same definition
   draws in the DOM as <path> and on canvas as a Path2D.
   ============================================================ */
export const ICONS: { id: string; label: string; d: string }[] = [
  { id: "check", label: "Check", d: "M20.3 6.4 9.6 17.1l-5.9-5.9 1.8-1.8 4.1 4.1 8.9-8.9z" },
  { id: "shield", label: "Shield", d: "M12 2 4 5v6.5c0 5 3.4 9.4 8 10.5 4.6-1.1 8-5.5 8-10.5V5zm-1 14-4-4 1.6-1.6L11 12.8l4.4-4.4L17 10z" },
  { id: "star", label: "Star", d: "M12 2.5l2.9 6.1 6.6.9-4.8 4.7 1.2 6.6L12 17.6 6.1 20.8l1.2-6.6L2.5 9.5l6.6-.9z" },
  { id: "spark", label: "Spark", d: "M12 2l2 6.5L20.5 11 14 13l-2 6.5-2-6.5L3.5 11 10 8.5z" },
  { id: "tag", label: "Price tag", d: "M11 2 2 11l11 11 9-9V2zm5.5 6a1.8 1.8 0 1 1 0-3.6 1.8 1.8 0 0 1 0 3.6z" },
  { id: "clock", label: "Clock", d: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 11h-4v-2h2V6h2z" },
  { id: "pin", label: "Location", d: "M12 2a7 7 0 0 0-7 7c0 5.3 7 13 7 13s7-7.7 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" },
  { id: "phone", label: "Phone", d: "M6.6 3h3l1.6 4-2.1 1.6a12 12 0 0 0 5.3 5.3L16 11.8l4 1.6v3c0 .9-.7 1.6-1.6 1.6A15 15 0 0 1 3 4.6C3 3.7 3.7 3 4.6 3z" },
  { id: "arrow", label: "Arrow", d: "M13.5 4 12 5.5 17 10.5H3v2h14L12 17.5 13.5 19l7.5-7.5z" },
  { id: "car", label: "Car", d: "M5 11l1.6-4.4A2 2 0 0 1 8.5 5h7a2 2 0 0 1 1.9 1.6L19 11h1v6h-2.5a2 2 0 1 1-4 0h-3a2 2 0 1 1-4 0H4v-6zm2.2-.6h9.6l-1.1-3.1a.6.6 0 0 0-.6-.4H8.9a.6.6 0 0 0-.6.4z" },
  { id: "wallet", label: "Wallet", d: "M3 6.5A2.5 2.5 0 0 1 5.5 4H18v3H5.5a.5.5 0 0 0 0 1H20a1 1 0 0 1 1 1v8a2 2 0 0 1-2 2H5.5A2.5 2.5 0 0 1 3 16.5zm13 5.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z" },
  { id: "percent", label: "Percent", d: "M6.5 4a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zm11 11a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM19 4.6 5.6 20 4 18.6 17.4 3.2z" },
];
export const ICON = (id: string) => ICONS.find(i => i.id === id) ?? ICONS[0];

/* ============================================================
   FACTORIES
   ============================================================ */

let seq = 0;
export const layerId = (kind: string) => `${kind}-${(seq++).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

export interface NewLayerDefaults {
  font: string;
  color: string;
  color2: string;
  ctaBg: string;
  ctaInk: string;
}

export function textLayer(d: NewLayerDefaults, over: Partial<TextLayer> = {}): TextLayer {
  return {
    id: layerId("text"),
    kind: "text",
    name: "Text",
    on: true,
    pos: { x: 0.08, y: 0.4 },
    text: "New line of copy",
    font: d.font,
    size: 4,
    blockW: 80,
    color: d.color,
    color2: d.color2,
    lineHeight: null,
    tracking: 0,
    upper: false,
    align: "left",
    scrim: noPlate(),
    grad: { on: false, to: d.color2, angle: 90 },
    ...over,
  };
}

export function ctaLayer(d: NewLayerDefaults, over: Partial<CtaLayer> = {}): CtaLayer {
  return {
    id: layerId("cta"),
    kind: "cta",
    name: "Call to action",
    on: true,
    pos: { x: 0.08, y: 0.56 },
    text: "Download the app",
    font: d.font,
    size: 2.6,
    bg: solid(d.ctaBg),
    ink: d.ctaInk,
    // square by default: a pill reads as a mobile OS button rather than an ad
    radius: 0,
    ...over,
  };
}

export function logoLayer(over: Partial<LogoLayer> = {}): LogoLayer {
  return {
    id: layerId("logo"),
    kind: "logo",
    name: "Logo",
    on: true,
    pos: { x: 0.06, y: 0.05 },
    // 22% of frame width read as an afterthought against the artwork
    w: 28,
    // a tight brand block, not a soft halo: pad is a % of the logo's own width,
    // so 9 puts a clean margin round it and nothing more
    plate: { ...noPlate("#141652", 100), pad: 9, radius: 4 },
    band: { on: false, fill: solid("#141652", 85), pad: 30 },
    ...over,
  };
}

export function shapeLayer(over: Partial<ShapeLayer> = {}): ShapeLayer {
  return {
    id: layerId("shape"),
    kind: "shape",
    name: "Shape",
    on: true,
    pos: { x: 0.1, y: 0.3 },
    shape: "rect",
    w: 40,
    h: 12,
    fill: solid("#FF5450", 100),
    radius: 8,
    rotation: 0,
    src: null,
    ...over,
  };
}

export function screenLayer(over: Partial<ScreenLayer> = {}): ScreenLayer {
  return {
    id: layerId("screen"),
    kind: "screen",
    name: "App screen",
    on: true,
    // a phone-shaped box in the middle, ready to be pinned to the real one
    pos: { x: 0.3, y: 0.3 },
    w: 34,
    h: 38,
    src: null,
    corners: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    radius: 6,
    gloss: 12,
    ...over,
  };
}

export function iconLayer(over: Partial<IconLayer> = {}): IconLayer {
  return {
    id: layerId("icon"),
    kind: "icon",
    name: "Icon",
    on: true,
    pos: { x: 0.1, y: 0.2 },
    icon: "check",
    src: null,
    w: 8,
    color: "#BFFF00",
    rotation: 0,
    scrim: { ...noPlate("#FFFFFF", 100), pad: 30, radius: 50 },
    ...over,
  };
}

/** A band is a full-width strip — the shape most ad layouts actually need. */
export const bandLayer = (over: Partial<ShapeLayer> = {}) =>
  shapeLayer({
    name: "Band",
    shape: "band",
    pos: { x: 0, y: 0.72 },
    w: 100,
    h: 14,
    radius: 0,
    fill: solid("#141652", 90),
    ...over,
  });

/**
 * The default stack, matching what the tool looked like before layers existed:
 * logo, brand eyebrow, headline, CTA. Nothing regresses visually.
 */
/**
 * The two brand shapes, as things you drop in rather than layouts you switch
 * to. Switching layout rebuilt the whole stack and threw away the copy and the
 * positions with it; adding a shape leaves everything else alone, which is what
 * you actually want when a photograph turns out to need a backing block.
 */
/**
 * A cut-out subject, drawn in front of everything.
 *
 * This is what lets a brand block sit *behind* the person instead of over them.
 * The artwork stays where it is as the background, the block goes on top of it,
 * and this layer puts the subject back in front — so the shape reads as if it
 * were behind them.
 */
export function cutoutLayer(src: string, aspect: number, over: Partial<ShapeLayer> = {}): ShapeLayer {
  const w = 74;
  return shapeLayer({
    name: "Cut-out",
    shape: "rect",
    src,
    srcFit: "contain",
    w,
    // aspect is height/width, and h is a percentage of frame height, so the
    // caller passes the frame's own ratio in to keep the subject undistorted
    h: Math.min(100, w * aspect),
    pos: { x: 0.13, y: 1 - Math.min(1, (w * aspect) / 100) },
    fill: { color: "#000000", color2: null, angle: 90, opacity: 0 },
    radius: 0,
    ...over,
  });
}

export function chevronLayer(over: Partial<ShapeLayer> = {}): ShapeLayer {
  return shapeLayer({
    name: "Brand block",
    shape: "chevron",
    w: 62,
    h: 100,
    pos: { x: -0.06, y: 0 },
    fill: solid("#141652", 100),
    radius: 0,
    ...over,
  });
}

export function stripLayer(over: Partial<ShapeLayer> = {}): ShapeLayer {
  return shapeLayer({
    name: "Lower third",
    shape: "band",
    h: 30,
    pos: { x: 0, y: 0.7 },
    fill: { color: "#141652", color2: "#141652", angle: 90, opacity: 96 },
    radius: 0,
    ...over,
  });
}

export function defaultStack(d: NewLayerDefaults, brand: string, head: string, cta: string): Layer[] {
  return [
    logoLayer(),
    textLayer(d, {
      name: "Brand line",
      text: brand,
      size: 3.2,
      tracking: 0.12,
      upper: true,
      pos: { x: 0.08, y: 0.36 },
    }),
    textLayer(d, { name: "Headline", text: head, size: 6.2, pos: { x: 0.08, y: 0.4 } }),
    ctaLayer(d, { text: cta }),
  ];
}

export const LAYER_LABEL: Record<LayerKind, string> = {
  text: "Text",
  cta: "Button",
  logo: "Logo",
  shape: "Shape",
  icon: "Icon",
  screen: "App screen",
};
