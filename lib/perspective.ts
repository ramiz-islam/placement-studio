/**
 * Mapping a flat image onto four arbitrary corners.
 *
 * Dropping an app screenshot into a photograph of a phone is the most common
 * shot in app advertising, and it cannot be done with position, size and
 * rotation: the phone is held at an angle, so the screen is a trapezium, not a
 * rectangle. That needs a homography — the transform that takes the four
 * corners of the source to four points you choose.
 *
 * Both renderers use the same maths from here: the browser gets it as a CSS
 * `matrix3d`, and the canvas exporter gets per-pixel mapping it can subdivide,
 * so the export matches what the preview showed.
 */

export type Quad = [Pt, Pt, Pt, Pt];
export interface Pt {
  x: number;
  y: number;
}

/** A 3x3 homography, row-major. */
export type H = [number, number, number, number, number, number, number, number, number];

/**
 * The homography taking the unit square — (0,0), (1,0), (1,1), (0,1) — to `q`,
 * given in the same order: top-left, top-right, bottom-right, bottom-left.
 *
 * Solved directly rather than by a general linear solver: for the unit square
 * the eight equations collapse to this closed form, which is both faster and
 * free of the pivoting a hand-rolled Gaussian elimination would need.
 */
export function squareToQuad(q: Quad): H | null {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;

  const den = dx1 * dy2 - dy1 * dx2;
  if (!Number.isFinite(den) || Math.abs(den) < 1e-12) return null;

  const g = (dx3 * dy2 - dy3 * dx2) / den;
  const h = (dx1 * dy3 - dy1 * dx3) / den;
  const a = p1.x - p0.x + g * p1.x;
  const b = p3.x - p0.x + h * p3.x;
  const c = p0.x;
  const d = p1.y - p0.y + g * p1.y;
  const e = p3.y - p0.y + h * p3.y;
  const f = p0.y;

  return [a, b, c, d, e, f, g, h, 1];
}

/** Apply a homography to a point in unit-square space. */
export function applyH(m: H, x: number, y: number): Pt {
  const w = m[6] * x + m[7] * y + m[8];
  if (!w) return { x: 0, y: 0 };
  return {
    x: (m[0] * x + m[1] * y + m[2]) / w,
    y: (m[3] * x + m[4] * y + m[5]) / w,
  };
}

/**
 * The same transform as a CSS `matrix3d`, for an element that has already been
 * laid out at `w` x `h` pixels with its origin at the top left.
 *
 * CSS takes the matrix in column-major order and treats the third row and
 * column as the z axis, so the 2D homography's perspective row (g, h) lands in
 * the fourth column. Pre-scaling by 1/w and 1/h maps the element's own pixels
 * onto the unit square the homography expects.
 */
export function cssMatrix(m: H, w: number, h: number): string {
  const sx = 1 / Math.max(1e-6, w);
  const sy = 1 / Math.max(1e-6, h);
  // columns: x', y', z', w'
  const v = [
    m[0] * sx, m[3] * sx, 0, m[6] * sx,
    m[1] * sy, m[4] * sy, 0, m[7] * sy,
    0, 0, 1, 0,
    m[2], m[5], 0, m[8],
  ];
  return `matrix3d(${v.map(n => (Math.abs(n) < 1e-9 ? 0 : Number(n.toFixed(8)))).join(",")})`;
}

/**
 * Draw an image through a homography onto a canvas.
 *
 * Canvas 2D has only affine transforms, so the quad is cut into a grid of small
 * pieces and each is drawn with the affine map that is correct at its corners.
 * A perspective transform is locally affine, so the error falls off with the
 * cell size; 24 divisions is past the point where it is visible at ad
 * resolutions and still one frame's work.
 */
export function drawQuad(
  g: CanvasRenderingContext2D,
  img: CanvasImageSource,
  iw: number,
  ih: number,
  quad: Quad,
  divisions = 24
) {
  const m = squareToQuad(quad);
  if (!m) return;
  const n = Math.max(1, Math.min(64, divisions));

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const u0 = col / n;
      const u1 = (col + 1) / n;
      const v0 = row / n;
      const v1 = (row + 1) / n;

      const a = applyH(m, u0, v0);
      const b = applyH(m, u1, v0);
      const c = applyH(m, u0, v1);

      // the affine map that sends this cell of the source to this cell of the
      // quad, taken from three corners — the fourth follows for a parallelogram
      // and the error is what the subdivision is there to shrink
      const sw = (u1 - u0) * iw;
      const sh = (v1 - v0) * ih;
      if (sw <= 0 || sh <= 0) continue;

      g.save();
      g.beginPath();
      // a hair of overlap, or seams show between cells
      g.setTransform(
        (b.x - a.x) / sw,
        (b.y - a.y) / sw,
        (c.x - a.x) / sh,
        (c.y - a.y) / sh,
        a.x,
        a.y
      );
      g.rect(0, 0, sw + 0.6, sh + 0.6);
      g.clip();
      g.drawImage(img, u0 * iw, v0 * ih, sw, sh, 0, 0, sw + 0.6, sh + 0.6);
      g.restore();
    }
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
}
