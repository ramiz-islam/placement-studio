/**
 * Per-placement audit. Every check states what is wrong, where, and what to do
 * about it — a score alone is not actionable.
 */

import { isRTL, type CreativeMeta, type Design, type Fit, type Placement } from "./core";
import { busyOfRect, collision, detailMap, focal, lumaOfRect, type Collision } from "./analysis";
import type { Layer } from "./layers";
import {
  RATIO_LABEL,
  clamp,
  contrastRatio,
  hexLuma,
  inkOf,
  intrusion,
  placeAll,
  safeF,
  type LayoutContext,
} from "./geometry";

export type Level = "ok" | "warn" | "bad";
export interface Check {
  level: Level;
  title: string;
  tag: string;
  /** may contain <b> only */
  detail: string;
  /**
   * Points this check took off. Shown next to the check, because a score
   * nobody can take apart is a score nobody trusts — and this one is meant to
   * gate whether a creative gets shared.
   */
  penalty: number;
}
export interface AuditResult {
  score: number;
  checks: Check[];
  col: Collision;
}

export interface AuditInput {
  pl: Placement;
  img: HTMLImageElement;
  meta: CreativeMeta;
  design: Design;
  logo: HTMLImageElement | null;
  fit: Fit;
  padColor: string;
  ver: number;
}

/**
 * The layer kinds the score judges: the logo, any text (headline, brand line,
 * anything else you add) and the button. Shapes, bands and icons are treated as
 * design, not as content that has to clear the furniture.
 */
/**
 * Every penalty in one place, with the label the panel shows.
 *
 * These used to be numbers written inline at each check and a hand-kept table
 * in the panel. They drifted — the panel advertised -6 for a resolution
 * failure the code charged -15 for. A score people gate work on cannot have
 * two versions of its own rules, so the checks and the published table now
 * read the same object.
 */
export const PENALTIES = {
  artworkInBand: { max: 30, label: "Artwork in a reserved band" },
  aspectHeavyCrop: { cost: 20, label: "Heavy crop from the wrong ratio" },
  aspectLetterboxed: { cost: 16, label: "Letterbox padding on a full-bleed slot" },
  aspectLightCrop: { cost: 6, label: "Light crop from a near-miss ratio" },
  resolutionHard: { cost: 14, label: "Source upscaled more than 1.35x" },
  resolutionSoft: { cost: 6, label: "Source upscaled 1.12x to 1.35x" },
  fileSize: { cost: 12, label: "File over the platform ceiling" },
  focalInBand: { cost: 9, label: "Focal point inside a reserved band" },
  layerIntrusion: { min: 5, max: 24, label: "Logo, text or button outside the safe box" },
  smallType: { cost: 6, label: "Type too small to read on a phone" },
  contrastFails: { cost: 11, label: "Type under 3:1 on the artwork" },
  contrastThin: { cost: 4, label: "Type under 4.5:1 on the artwork" },
  ctaContrast: { cost: 6, label: "Button label under 4.5:1 on its own fill" },
  logoSmall: { cost: 3, label: "Logo layer with no image loaded" },
  rtlLayout: { cost: 8, label: "Arabic copy fighting the action rail" },
  multiCrop: { cost: 3, label: "One source re-cropped across many surfaces" },
} as const;

/** The published table, in the order it reads best. Derived, never retyped. */
export const PENALTY_ROWS: { label: string; cost: string }[] = [
  { label: PENALTIES.artworkInBand.label, cost: `up to -${PENALTIES.artworkInBand.max}` },
  { label: PENALTIES.aspectHeavyCrop.label, cost: `-${PENALTIES.aspectHeavyCrop.cost}` },
  { label: PENALTIES.aspectLetterboxed.label, cost: `-${PENALTIES.aspectLetterboxed.cost}` },
  { label: PENALTIES.resolutionHard.label, cost: `-${PENALTIES.resolutionHard.cost}` },
  { label: PENALTIES.fileSize.label, cost: `-${PENALTIES.fileSize.cost}` },
  { label: PENALTIES.contrastFails.label, cost: `-${PENALTIES.contrastFails.cost} each` },
  { label: PENALTIES.focalInBand.label, cost: `-${PENALTIES.focalInBand.cost}` },
  { label: PENALTIES.rtlLayout.label, cost: `-${PENALTIES.rtlLayout.cost}` },
  {
    label: PENALTIES.layerIntrusion.label,
    cost: `-${PENALTIES.layerIntrusion.min} to -${PENALTIES.layerIntrusion.max} each`,
  },
  { label: PENALTIES.smallType.label, cost: `-${PENALTIES.smallType.cost} each` },
  { label: PENALTIES.ctaContrast.label, cost: `-${PENALTIES.ctaContrast.cost}` },
  { label: PENALTIES.resolutionSoft.label, cost: `-${PENALTIES.resolutionSoft.cost}` },
  { label: PENALTIES.aspectLightCrop.label, cost: `-${PENALTIES.aspectLightCrop.cost}` },
  { label: PENALTIES.contrastThin.label, cost: `-${PENALTIES.contrastThin.cost} each` },
  { label: PENALTIES.logoSmall.label, cost: `-${PENALTIES.logoSmall.cost}` },
  { label: PENALTIES.multiCrop.label, cost: `-${PENALTIES.multiCrop.cost}` },
];

const SCORED_KINDS = new Set<Layer["kind"]>(["logo", "text", "cta"]);

export function audit(input: AuditInput): AuditResult {
  const { pl, img, meta, design: d, logo, fit, padColor, ver } = input;
  const checks: Check[] = [];
  let score = 100;
  const add = (level: Level, title: string, tag: string, detail: string, penalty = 0) => {
    checks.push({ level, title, tag, detail, penalty });
    score -= penalty;
  };

  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const srcR = iw / ih;
  const dstR = pl.w / pl.h;

  // Computed up here because the ratio check needs it: judging a crop means
  // looking at what is in the strips being cut off. The checks below still run
  // in reading order.
  const map = detailMap(pl, img, fit, padColor, ver);
  const fp = focal(map);

  /* ---- ratio and crop ---- */
  const s = Math.max(pl.w / iw, pl.h / ih);
  const cropped = 1 - (pl.w * pl.h) / (iw * s * (ih * s));
  const axis = srcR > dstR ? "sides" : "top and bottom";
  if (Math.abs(srcR - dstR) / dstR < 0.02) {
    add("ok", "Aspect ratio", "exact", `Native ${RATIO_LABEL(dstR)}. Nothing is cropped or padded.`);
  } else if (fit === "contain") {
    const s2 = Math.min(pl.w / iw, pl.h / ih);
    const pad = 1 - (iw * s2 * (ih * s2)) / (pl.w * pl.h);
    add(
      "warn",
      "Aspect ratio",
      "letterboxed",
      `Source is <b>${RATIO_LABEL(srcR)}</b> on a ${RATIO_LABEL(dstR)} canvas, so about <b>${Math.round(
        pad * 100
      )}%</b> is padding. Export at ${pl.w} × ${pl.h} instead.`,
      PENALTIES.aspectLetterboxed.cost
    );
  } else if (cropped > 0.15) {
    /*
     * How much a crop costs depends on what is in the part being cut off, not
     * on how much of it there is.
     *
     * gpt-image's tallest output is 1024 x 1536, so every generated 9:16 ad is
     * 2:3 and loses about 16% off the sides. Charging 20 points for that meant
     * the tool produced an image and then failed it, which is not a judgement
     * anyone can act on. So look at the strips actually being discarded: if
     * they are quieter than the frame as a whole and the focal point survives,
     * the composition took the crop and the crop is a note, not a fault.
     */
    const keepW = dstR < srcR ? dstR / srcR : 1;
    const sideW = (1 - keepW) / 2;
    const lostBusy =
      sideW > 0.01
        ? Math.max(busyOfRect(map, 0, 0, sideW, 1), busyOfRect(map, 1 - sideW, 0, sideW, 1))
        : 0;
    const focalSafe = fp.x > sideW && fp.x < 1 - sideW;
    const survived = dstR < srcR && lostBusy < 0.95 && focalSafe;

    if (survived) {
      add(
        "warn",
        "Aspect ratio",
        "cropped, composition holds",
        `Source is <b>${RATIO_LABEL(srcR)}</b>; filling ${RATIO_LABEL(dstR)} trims <b>${Math.round(
          cropped * 100
        )}%</b> off the ${axis} — but those strips are quieter than the rest of the frame and the focal point stays inside. ` +
          `A dedicated ${pl.w} × ${pl.h} source would still be sharper.`,
        PENALTIES.aspectLightCrop.cost
      );
    } else {
      add(
        "bad",
        "Aspect ratio",
        "heavy crop",
        `Source is <b>${RATIO_LABEL(srcR)}</b>; filling ${RATIO_LABEL(dstR)} discards <b>${Math.round(
          cropped * 100
        )}%</b> off the ${axis}, and ${
          focalSafe ? "there is real detail in what goes" : "the focal point itself falls"
        } outside the crop. Generate or export a dedicated ${pl.w} × ${pl.h} version.`,
        PENALTIES.aspectHeavyCrop.cost
      );
    }
  } else if (cropped > 0.02) {
    add(
      "warn",
      "Aspect ratio",
      "light crop",
      `About <b>${Math.round(cropped * 100)}%</b> trimmed off the ${axis}. Survivable — check nothing important sat at the edge.`,
      PENALTIES.aspectLightCrop.cost
    );
  } else {
    add("ok", "Aspect ratio", "near match", `Within 2% of ${RATIO_LABEL(dstR)} — the crop is invisible.`);
  }

  /* ---- resolution ----
     What matters is not whether the source is smaller than the frame but how
     far it has to be stretched to fill it — which depends on the ratio, not
     just the pixel count. Comparing dimensions side by side failed a 1024x1536
     render against a 1080x1920 slot as "below spec" and took 15 points off,
     when the width was fine and the real cost was a 1.25x upscale. The export
     is always written at the placement's full size; the only question is how
     much of the detail in it is interpolated. */
  const upscale = Math.max(pl.w / iw, pl.h / ih);
  const upPct = Math.round((upscale - 1) * 100);
  if (upscale <= 1.02) {
    add("ok", "Resolution", `clears ${pl.w} × ${pl.h}`, `${iw} × ${ih} fills this frame with no upscaling.`);
  } else if (upscale <= 1.12) {
    add(
      "ok",
      "Resolution",
      `${upPct}% upscale`,
      `${iw} × ${ih} stretches <b>${upscale.toFixed(2)}×</b> to fill ${pl.w} × ${pl.h}. Not visible.`
    );
  } else if (upscale <= 1.35) {
    add(
      "warn",
      "Resolution",
      `${upPct}% upscale`,
      `${iw} × ${ih} stretches <b>${upscale.toFixed(2)}×</b> to fill ${pl.w} × ${pl.h}, so fine detail softens a little. ` +
        `Generated images top out at 1024 × 1536, which is why a 9:16 slot needs this much.`,
      PENALTIES.resolutionSoft.cost
    );
  } else {
    add(
      "bad",
      "Resolution",
      `${upPct}% upscale`,
      `${iw} × ${ih} has to stretch <b>${upscale.toFixed(2)}×</b> to fill ${pl.w} × ${pl.h}. ` +
        `That is past the point where it stays sharp — use a larger source.`,
      PENALTIES.resolutionHard.cost
    );
  }

  /* ---- file size ---- */
  const mb = meta.bytes / 1048576;
  if (mb > pl.maxMB) {
    add("bad", "File size", "over limit", `${mb.toFixed(1)} MB exceeds the ${pl.maxMB} MB ceiling.`, PENALTIES.fileSize.cost);
  } else {
    add("ok", "File size", `${mb.toFixed(1)} MB`, `Under the ${pl.maxMB} MB ceiling.`);
  }

  /* ---- artwork colliding with reserved bands ---- */
  const col = collision(pl, map, `${pl.id}|${fit}|${ver}`);
  const pct = Math.round(col.ratio * 100);
  const bandNames = Object.entries(col.bands)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);
  if (col.ratio > 0.18) {
    add(
      "bad",
      "Artwork in safe zone",
      "collision",
      `<b>${pct}%</b> of the reserved area carries dense detail, mostly ${bandNames.join(
        " and "
      )}. Platform UI will sit on top of it.`,
      Math.min(PENALTIES.artworkInBand.max, Math.round(col.ratio * 105))
    );
  } else if (col.ratio > 0.06) {
    add(
      "warn",
      "Artwork in safe zone",
      "partial",
      `<b>${pct}%</b> of the reserved area has busy detail, mainly ${bandNames.join(" and ")}.`,
      Math.round(col.ratio * 85)
    );
  } else {
    add("ok", "Artwork in safe zone", "clear", `Reserved bands are quiet — under ${Math.max(1, pct)}% busy detail.`);
  }

  /* ---- focal point ---- */
  const f = safeF(pl);
  if (!(fp.y > f.t && fp.y < 1 - f.b && fp.x > f.l && fp.x < 1 - f.r)) {
    const where =
      fp.y <= f.t ? "top band" : fp.y >= 1 - f.b ? "bottom band" : fp.x <= f.l ? "left edge" : "right rail";
    add(
      "warn",
      "Focal point",
      "behind chrome",
      `The busiest region falls in the <b>${where}</b>. Whatever the eye lands on first is what the UI covers.`,
      PENALTIES.focalInBand.cost
    );
  } else {
    add("ok", "Focal point", "in the clear", "The densest region sits inside the safe box.");
  }

  /* ---- every layer, checked on its own terms ---- */
  const ctx: LayoutContext = {
    lang: d.lang,
    logoAspect: logo ? logo.naturalHeight / logo.naturalWidth : 0.3,
  };

  if (d.copyOn) {
    const placed = placeAll(pl, d, ctx);
    let clean = 0;

    for (const p of placed) {
      const l = p.layer;
      // Only the four things a viewer has to be able to read are scored.
      //
      // Shapes and icons are decoration: bleeding a brand block off the edge or
      // running a strip under the caption is a deliberate move, and marking it
      // as a safe-zone failure trained people to ignore the score. What matters
      // is whether the logo, the headline, the brand line and the button
      // survive the platform's furniture.
      if (!SCORED_KINDS.has(l.kind)) continue;
      if (l.kind === "logo" && !logo) continue;

      // measure what is painted, not the block it is laid out in
      const hit = intrusion(pl, inkOf(p));
      if (hit.worst > 4) {
        add(
          "bad",
          l.name,
          `overlaps ${hit.side}`,
          `Crosses <b>${hit.worst}px</b> into the ${hit.side} reserved band. Drag it inward, or use Snap into this safe box.`,
          clamp(Math.round((hit.worst / pl.h) * 240), PENALTIES.layerIntrusion.min, PENALTIES.layerIntrusion.max)
        );
      } else {
        clean++;
      }

      if (l.kind === "text") {
        if (l.size < 3 && l.text.trim()) {
          add(
            "warn",
            l.name,
            "small type",
            `<b>${l.size.toFixed(1)}%</b> of frame width (${Math.round(
              (pl.w * l.size) / 100
            )}px). Under 3% is hard work on a phone at arm's length.`,
            PENALTIES.smallType.cost
          );
        }
        // a stroke or a shadow does the same job as a scrim: it separates the
        // glyphs from whatever is behind them, so the raw contrast of ink
        // against artwork is no longer the whole story
        const backed = l.scrim.on || l.stroke?.on || l.shadow?.on;
        if (!backed && l.text.trim()) {
          const bgL = lumaOfRect(map, p.box.x, p.box.y, p.box.w, p.box.h);
          const cr = contrastRatio(hexLuma(l.color), bgL);
          if (cr < 3) {
            add(
              "bad",
              l.name,
              "contrast fails",
              `About <b>${cr.toFixed(1)}:1</b> against the artwork underneath. Large text needs 3:1. Add a scrim or change the colour.`,
              PENALTIES.contrastFails.cost
            );
          } else if (cr < 4.5) {
            add(
              "warn",
              l.name,
              "contrast thin",
              `About <b>${cr.toFixed(1)}:1</b> — clears the large-text bar but will struggle in Gulf sunlight.`,
              PENALTIES.contrastThin.cost
            );
          }
        }
      }

      if (l.kind === "cta") {
        const cr = contrastRatio(hexLuma(l.ink), hexLuma(l.bg.color));
        if (cr < 4.5) {
          add(
            cr < 3 ? "bad" : "warn",
            l.name,
            `${cr.toFixed(1)}:1`,
            `Button label against its own fill is <b>${cr.toFixed(1)}:1</b>. Buttons need 4.5:1 to read at speed.`,
            PENALTIES.ctaContrast.cost
          );
        }
      }

    }

    if (clean && clean === placed.filter(p => SCORED_KINDS.has(p.layer.kind)).length) {
      add("ok", "Layer placement", `${clean} clear`, "Every layer sits inside this placement's safe box.");
    }

    if (!logo && d.layers.some(l => l.kind === "logo" && l.on)) {
      add(
        "warn",
        "Logo",
        "no file",
        "A logo layer exists but no image is loaded. Brand recognition inside the first 2 seconds is the single biggest lever on Snap and TikTok.",
        PENALTIES.logoSmall.cost
      );
    }

    /* ---- RTL against a right-hand rail ---- */
    if (isRTL(d.lang) && pl.rail) {
      add(
        "warn",
        "RTL layout",
        "rail conflict",
        `Arabic sets from the right, which is where this placement stacks its action icons (${pl.safe.r}px). Mirror the layout: anchor right but inside the rail, or push left.`,
        PENALTIES.rtlLayout.cost
      );
    }
  }

  /* ---- platform re-crops ---- */
  if (pl.multiCrop) {
    add(
      "warn",
      "Multi-crop",
      "re-cropped by platform",
      "This asset is served across 4:5, 1:1 and 1.91:1 surfaces. Only the <b>centre square</b> is guaranteed.",
      PENALTIES.multiCrop.cost
    );
  }
  if (pl.gridCrop) {
    add(
      "warn",
      "Profile grid",
      "1:1 crop",
      `Your profile grid squares this off, taking ${Math.round((1 - 1080 / 1350) * 100)}% off the height.`
    );
  }

  return { score: clamp(Math.round(score), 0, 100), checks, col };
}

/**
 * The bar is 70. Marketing gates sharing on it, so the wording says plainly
 * whether a creative is over or under rather than grading on a curve.
 */
export const PASS_MARK = 70;

export const grade = (score: number) =>
  score >= 85
    ? { label: "Ready to ship", color: "var(--lime-ink)" }
    : score >= PASS_MARK
      ? { label: `Clears the ${PASS_MARK} bar`, color: "var(--lime-ink)" }
      : score >= 50
        ? { label: `Under ${PASS_MARK} — do not share yet`, color: "var(--amber-ink)" }
        : { label: `Under ${PASS_MARK} — rework the layout`, color: "var(--coral-ink)" };
