/**
 * Prompt construction for both generation routes. DOM-free — imported by the
 * API routes.
 *
 * The important decision encoded here: images are generated WITHOUT text by
 * default. Baked-in text cannot be repositioned per placement, cannot be
 * translated, and cannot be checked against a safe zone. The studio's own copy
 * layers do all three, so the model's job is the picture.
 */

import { CREATIVE_TYPES, PLACEMENTS, SHAPES, type Lang } from "./core";

/* ============================================================
   BRAND VOICE — edit here, not in the routes
   ============================================================ */
export const VOICE = {
  brand: "CarSwitch",
  proposition: "The smoothest way to buy or sell a trusted car.",
  tagline: { en: "Let us take over", ar: "خليها علينا" },
  sounds: [
    "reliable",
    "trustworthy",
    "like a knowledgeable friend",
    "human and approachable",
    "confident",
    "honest",
    "casual but credible",
    "locally relevant",
  ],
  neverSounds: [
    "childish",
    "boring",
    "naive",
    "provocative",
    "formal or uptight",
    "pushy",
    "overexplaining",
    "cheesy",
    "over-promising",
    "old-fashioned",
    "souq-like or disorganised",
    "overly technical",
  ],
  rules: [
    "Headlines are sentence case — only the first letter capitalised.",
    "Push the app, not the website. Never reference a .com in new copy.",
    "Never combine more than three colours in one creative: one light neutral plus two bold brand colours, at least one of which is Night Sky or Sunset.",
  ],
};

const REGISTER: Record<Lang, string> = {
  en: "British-leaning English. Plain, confident, no exclamation marks.",
  najdi:
    "Najdi / Saudi colloquial Arabic — the Riyadh register, the way people actually speak in KSA. Not Modern Standard Arabic and not generic Gulf. Use الحين rather than الآن, use ودّي / أبغى shapes where natural, keep it short and spoken. Avoid anything that reads like a textbook or a press release.",
  gulf:
    "General Khaleeji colloquial Arabic for a UAE audience. Understandable across the Gulf, spoken register, not Modern Standard Arabic. Avoid strongly Saudi-specific vocabulary.",
  msa:
    "Modern Standard Arabic. Use this only for formal or legal contexts — it reads cold in advertising.",
};

/* ============================================================
   IMAGE PROMPT
   ============================================================ */

export interface ImageBrief {
  typeId: string;
  brief: string;
  shapeId: string;
  market: string;
  brandName: string;
  palette: { headColor: string; ctaBg: string; ctaInk: string };
  /** bake the headline into the pixels — off by default, and we say why */
  includeText: boolean;
  headline?: string;
  cta?: string;
  /** an existing creative is being rebuilt */
  hasReference: boolean;
  /**
   * Compose so one asset survives every channel, not just the target shape.
   * On by default: a generation that only works in one placement is a wasted
   * credit, because the same brief has to be run again for the others.
   */
  universal?: boolean;
}

/**
 * The deepest bottom band across every placement this shape feeds. Passed to
 * the model as a composition constraint, which is the whole point of building
 * generation inside the preview tool rather than beside it.
 */
/**
 * The strictest reserved bands across EVERY placement, regardless of ratio.
 * This is what "works on every channel" has to clear.
 */
export function reservedEverywhere() {
  const bottom = Math.max(...PLACEMENTS.map(p => p.safe.b / p.h));
  const top = Math.max(...PLACEMENTS.map(p => p.safe.t / p.h));
  const right = Math.max(...PLACEMENTS.map(p => p.safe.r / p.w));
  const worstPl = PLACEMENTS.reduce((x, p) => (p.safe.b / p.h > x.safe.b / x.h ? p : x));
  return { bottom, top, right, worst: `${worstPl.plat} ${worstPl.name}` };
}

export function reservedForShape(shapeId: string) {
  const shape = SHAPES.find(s => s.id === shapeId) || SHAPES[0];
  // Explicit bands, so no placement's membership depends on float rounding.
  // Portrait covers 9:16 through 4:5; square is 1:1 only; landscape is 1.91:1 and wider.
  const band = shape.ratio < 0.9 ? "tall" : shape.ratio > 1.2 ? "wide" : "square";
  const group = PLACEMENTS.filter(p => {
    const r = p.w / p.h;
    if (band === "tall") return r < 0.9;
    if (band === "wide") return r > 1.2;
    return r >= 0.9 && r <= 1.2;
  });
  if (!group.length) return { bottom: 0.2, top: 0.1, right: 0, worst: null as string | null };
  const bottom = Math.max(...group.map(p => p.safe.b / p.h));
  const top = Math.max(...group.map(p => p.safe.t / p.h));
  const right = Math.max(...group.map(p => p.safe.r / p.w));
  const worstPl = group.reduce((x, p) => (p.safe.b / p.h > x.safe.b / x.h ? p : x));
  return { bottom, top, right, worst: `${worstPl.plat} ${worstPl.name}` };
}

const MARKET_CUE: Record<string, string> = {
  ksa: "Setting and casting read as Saudi Arabia — regional architecture, strong warm daylight, wardrobe appropriate and modest for the market. Where a person appears, they should look local to Riyadh or Jeddah rather than generically Western.",
  uae: "Setting and casting read as the UAE — Gulf urban context, mixed international population, modern architecture, wardrobe appropriate for the market.",
  intl: "Neutral international setting with no strong regional markers.",
};

export function buildImagePrompt(b: ImageBrief): string {
  const type = CREATIVE_TYPES.find(t => t.id === b.typeId) || CREATIVE_TYPES[0];
  const shape = SHAPES.find(s => s.id === b.shapeId) || SHAPES[0];
  const universal = b.universal !== false;
  const zone = universal ? reservedEverywhere() : reservedForShape(b.shapeId);
  const botPct = Math.round(zone.bottom * 100);
  const topPct = Math.round(zone.top * 100);
  const rightPct = Math.round(zone.right * 100);

  const parts: string[] = [];

  parts.push(
    `A single ${shape.label.toLowerCase()} advertising image for ${b.brandName}, a car marketplace. Subject: ${b.brief.trim()}`
  );

  parts.push(`ART DIRECTION. ${type.direction}`);

  if (b.hasReference) {
    parts.push(
      "REFERENCE. Use the supplied image as the compositional reference described in the art direction above."
    );
  }

  parts.push(MARKET_CUE[b.market] || MARKET_CUE.intl);

  parts.push(
    universal
      ? `COMPOSITION — THIS IS THE HARDEST CONSTRAINT, TREAT IT AS A REQUIREMENT. One asset has to survive every social placement: 9:16 stories and reels, 4:5 and 2:3 feeds, 1:1 squares and 1.91:1 banners. That means two things. First, the entire message must sit inside the CENTRE SQUARE of the frame, because every other ratio is a crop of it — nothing that matters may live outside that square. Second, the bottom ${botPct}%, the top ${topPct}% and the right ${rightPct}% are covered by platform interface (${zone.worst} is the worst case) and must be visually simple: background, gradient, sky, road, empty wall — never the subject's face, never a product edge, never fine detail. Place the subject centred and slightly above centre, comfortably inside the safe area, not touching any frame edge, and leave one genuinely quiet band for a headline to be composited afterwards.`
      : `COMPOSITION. This asset will be cropped into feed placements that cover the edges with their own interface. Keep the bottom ${botPct}% and the top ${topPct}% of the frame visually simple — background, gradient or empty space, no part of the subject that matters. ${
          zone.worst ? `${zone.worst} has the deepest interface furniture at ${botPct}%.` : ""
        } Put the subject in the upper-middle of the frame with the focal point clearly inside the central area, and leave one genuinely quiet band where a headline will be placed afterwards. Do not let the subject touch the frame edges — the asset is re-cropped to other ratios.`
  );

  parts.push(
    `PALETTE. Build around ${b.palette.ctaBg} and ${b.palette.headColor} against a deep navy or a clean neutral. At most three colours in the whole image. No rainbow gradients, no unrelated accent colours.`
  );

  if (b.includeText && (b.headline || b.cta)) {
    parts.push(
      `TEXT. Render exactly this text and nothing else, spelled precisely: ${[b.headline, b.cta]
        .filter(Boolean)
        .map(t => `"${t}"`)
        .join(" and ")}. Set it in a clean bold geometric sans, inside the central area, well clear of the bottom ${botPct}%. No other words, no invented words, no watermark, no signature.`
    );
  } else {
    parts.push(
      "TEXT. Render no text at all — no words, letters, numbers, captions, labels, logos, watermarks or signatures anywhere in the image. Headline, call to action and logo are composited afterwards as editable layers."
    );
  }

  parts.push(
    "AVOID. Stock-photo staging, obviously composited elements, warped or extra limbs, mangled car badges, dealership balloons, price stickers, on-image UI mockups, borders and frames."
  );

  return parts.join("\n\n");
}

/* ============================================================
   COPY PROMPT (Claude)
   ============================================================ */

export interface CopyBrief {
  brief: string;
  lang: Lang;
  market: string;
  brandName: string;
  /** existing copy to translate or rework, if any */
  source?: string;
  count: number;
  /** hard character ceilings from the placement the user is working in */
  headlineMax?: number;
  ctaMax?: number;
}

export function copySystemPrompt(b: CopyBrief): string {
  return [
    `You are a senior bilingual advertising copywriter for ${b.brandName}, a car marketplace operating in Saudi Arabia and the UAE.`,
    "",
    `Proposition: ${VOICE.proposition}`,
    `Approved tagline: "${VOICE.tagline.en}" / "${VOICE.tagline.ar}".`,
    "",
    `The brand SHOULD sound: ${VOICE.sounds.join(", ")}.`,
    `The brand must NEVER sound: ${VOICE.neverSounds.join(", ")}.`,
    "",
    "Rules:",
    ...VOICE.rules.map(r => `- ${r}`),
    `- Target register: ${REGISTER[b.lang]}`,
    b.headlineMax ? `- Headline must be at most ${b.headlineMax} characters.` : "",
    b.ctaMax ? `- Call to action must be at most ${b.ctaMax} characters.` : "",
    "- A call to action is 2 to 4 words. It names the action, not the benefit.",
    "- Never translate word for word. Write the line a native speaker of this register would actually say.",
    "",
    "Return ONLY a JSON object, no prose and no code fence, shaped exactly:",
    '{"variants":[{"headline":"...","cta":"...","note":"one short line on why this works for this market"}]}',
    `Return exactly ${b.count} variants, ordered strongest first.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function copyUserPrompt(b: CopyBrief): string {
  const lines = [`Brief: ${b.brief.trim() || "General brand awareness."}`, `Market: ${b.market.toUpperCase()}`];
  if (b.source) {
    lines.push(
      `Existing copy to carry across (match the intent and the energy, not the words): ${b.source.trim()}`
    );
  }
  return lines.join("\n");
}
