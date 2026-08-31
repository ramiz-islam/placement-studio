/**
 * Per-placement audit. Every check states what is wrong, where, and what to
 * do about it — a score alone is not actionable.
 */

import { isRTL, type CreativeMeta, type Design, type Fit, type Placement } from "./core";
import { collision, detailMap, focal, lumaOfRect, type Collision } from "./analysis";
import { RATIO_LABEL, clamp, contrastRatio, hexLuma, intrusion, layout, safeF } from "./geometry";

export type Level = "ok" | "warn" | "bad";
export interface Check {
  level: Level;
  title: string;
  tag: string;
  /** may contain <b> only */
  detail: string;
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

export function audit(input: AuditInput): AuditResult {
  const { pl, img, meta, design: d, logo, fit, padColor, ver } = input;
  const checks: Check[] = [];
  let score = 100;
  const add = (level: Level, title: string, tag: string, detail: string, penalty = 0) => {
    checks.push({ level, title, tag, detail });
    score -= penalty;
  };

  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const srcR = iw / ih;
  const dstR = pl.w / pl.h;

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
      16
    );
  } else if (cropped > 0.15) {
    add(
      "bad",
      "Aspect ratio",
      "heavy crop",
      `Source is <b>${RATIO_LABEL(srcR)}</b>; filling ${RATIO_LABEL(dstR)} discards <b>${Math.round(
        cropped * 100
      )}%</b> off the ${axis}. Generate or export a dedicated ${pl.w} × ${pl.h} version.`,
      20
    );
  } else if (cropped > 0.02) {
    add(
      "warn",
      "Aspect ratio",
      "light crop",
      `About <b>${Math.round(cropped * 100)}%</b> trimmed off the ${axis}. Survivable — check nothing important sat at the edge.`,
      6
    );
  } else {
    add("ok", "Aspect ratio", "near match", `Within 2% of ${RATIO_LABEL(dstR)} — the crop is invisible.`);
  }

  /* ---- resolution ---- */
  if (iw < pl.w * 0.9 || ih < pl.h * 0.9) {
    add(
      "bad",
      "Resolution",
      "below spec",
      `Uploaded at <b>${iw} × ${ih}</b> against ${pl.w} × ${pl.h}. It will be upscaled and soften.`,
      15
    );
  } else if (iw < pl.w || ih < pl.h) {
    add("warn", "Resolution", "borderline", `${iw} × ${ih} is just under ${pl.w} × ${pl.h}.`, 5);
  } else {
    add("ok", "Resolution", `clears ${pl.w}px`, `${iw} × ${ih} gives the compressor room to work.`);
  }

  /* ---- file size ---- */
  const mb = meta.bytes / 1048576;
  if (mb > pl.maxMB) {
    add("bad", "File size", "over limit", `${mb.toFixed(1)} MB exceeds the ${pl.maxMB} MB ceiling.`, 12);
  } else {
    add("ok", "File size", `${mb.toFixed(1)} MB`, `Under the ${pl.maxMB} MB ceiling.`);
  }

  /* ---- artwork colliding with reserved bands ---- */
  const map = detailMap(pl, img, fit, padColor, ver);
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
      Math.min(30, Math.round(col.ratio * 105))
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
  const fp = focal(map);
  const f = safeF(pl);
  if (!(fp.y > f.t && fp.y < 1 - f.b && fp.x > f.l && fp.x < 1 - f.r)) {
    const where =
      fp.y <= f.t ? "top band" : fp.y >= 1 - f.b ? "bottom band" : fp.x <= f.l ? "left edge" : "right rail";
    add(
      "warn",
      "Focal point",
      "behind chrome",
      `The busiest region falls in the <b>${where}</b>. Whatever the eye lands on first is what the UI covers.`,
      9
    );
  } else {
    add("ok", "Focal point", "in the clear", "The densest region sits inside the safe box.");
  }

  /* ---- copy layers ---- */
  const logoAspect = logo ? logo.naturalHeight / logo.naturalWidth : 0.3;
  const L = layout(pl, d, logoAspect);

  if (d.copyOn && (d.head || d.brand)) {
    const hi = intrusion(pl, L.head);
    if (hi.worst > 4) {
      add(
        "bad",
        "Headline placement",
        `overlaps ${hi.side}`,
        `The headline block crosses <b>${hi.worst}px</b> into the ${hi.side} reserved band. Drag it inward, or use Snap to safe box.`,
        clamp(Math.round((hi.worst / pl.h) * 260), 6, 26)
      );
    } else {
      add("ok", "Headline placement", "inside safe box", "Clears every reserved band on this placement.");
    }

    if (d.size < 4) {
      add(
        "warn",
        "Type size",
        "small",
        `Headline is <b>${d.size.toFixed(1)}%</b> of frame width (${Math.round(
          (pl.w * d.size) / 100
        )}px). Under 4% is hard work on a phone at arm's length.`,
        8
      );
    } else {
      add(
        "ok",
        "Type size",
        `${d.size.toFixed(1)}% · ${Math.round((pl.w * d.size) / 100)}px`,
        "Readable at thumb distance."
      );
    }

    const bgL = lumaOfRect(map, L.head.x, L.head.y, L.head.w, L.head.h);
    const cr = contrastRatio(hexLuma(d.headColor), bgL);
    if (d.scrim) {
      add("ok", "Headline contrast", "scrim on", "A scrim guarantees separation regardless of what sits underneath.");
    } else if (cr < 3) {
      add(
        "bad",
        "Headline contrast",
        "fails",
        `About <b>${cr.toFixed(
          1
        )}:1</b> against the artwork underneath. Large text needs 3:1. Add a scrim or change the colour.`,
        11
      );
    } else if (cr < 4.5) {
      add(
        "warn",
        "Headline contrast",
        "thin",
        `About <b>${cr.toFixed(1)}:1</b> — clears the large-text bar but will struggle in Gulf sunlight.`,
        4
      );
    } else {
      add("ok", "Headline contrast", `${cr.toFixed(1)}:1`, "Comfortable separation from the artwork.");
    }
  }

  if (d.copyOn && d.cta) {
    const ci = intrusion(pl, L.cta);
    if (ci.worst > 4) {
      add(
        "bad",
        "CTA placement",
        `overlaps ${ci.side}`,
        `The CTA crosses <b>${ci.worst}px</b> into the ${ci.side} reserved band.`,
        clamp(Math.round((ci.worst / pl.h) * 220), 5, 20)
      );
    } else {
      add("ok", "CTA placement", "inside safe box", "The CTA pill clears every reserved band here.");
    }
    const ctaCr = contrastRatio(hexLuma(d.ctaInk), hexLuma(d.ctaBg));
    if (ctaCr < 4.5) {
      add(
        ctaCr < 3 ? "bad" : "warn",
        "CTA contrast",
        `${ctaCr.toFixed(1)}:1`,
        `CTA text against its own background is <b>${ctaCr.toFixed(
          1
        )}:1</b>. Buttons need 4.5:1 to read at speed.`,
        6
      );
    } else {
      add("ok", "CTA contrast", `${ctaCr.toFixed(1)}:1`, "Button label reads cleanly against its fill.");
    }
  }

  if (logo) {
    const li = intrusion(pl, L.logo);
    if (li.worst > 4) {
      add(
        "bad",
        "Logo placement",
        `overlaps ${li.side}`,
        `The logo crosses <b>${li.worst}px</b> into the ${li.side} reserved band.`,
        clamp(Math.round((li.worst / pl.h) * 200), 4, 16)
      );
    } else {
      add("ok", "Logo placement", "inside safe box", "The logo sits clear of platform UI.");
    }
  } else if (d.copyOn) {
    add(
      "warn",
      "Logo",
      "not set",
      "No logo loaded. Brand recognition inside the first 2 seconds is the single biggest lever on Snap and TikTok.",
      3
    );
  }

  /* ---- RTL against a right-hand rail ---- */
  if (d.copyOn && isRTL(d.lang) && pl.rail) {
    add(
      "warn",
      "RTL layout",
      "rail conflict",
      `Arabic sets from the right, which is where this placement stacks its action icons (${pl.safe.r}px). Mirror the layout: anchor right but inside the rail, or push left.`,
      8
    );
  }

  /* ---- platform re-crops ---- */
  if (pl.multiCrop) {
    add(
      "warn",
      "Multi-crop",
      "re-cropped by platform",
      "This asset is served across 4:5, 1:1 and 1.91:1 surfaces. Only the <b>centre square</b> is guaranteed.",
      3
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

export const grade = (score: number) =>
  score >= 85
    ? { label: "Ready to ship", color: "var(--lime)" }
    : score >= 65
      ? { label: "Needs a pass", color: "var(--amber)" }
      : { label: "Rework the layout", color: "var(--coral-soft)" };
