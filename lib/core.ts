/**
 * Placement Studio — core data and types.
 *
 * DOM-free on purpose: the API routes import PLACEMENTS and the creative-type
 * table to build generation prompts, so nothing in here may touch `window`.
 *
 * The placement table is the single source of truth for safe zones. Platforms
 * revise their UI without notice — edit this file, not the components.
 */

import type { Layer } from "./layers";

export type Lang = "en" | "najdi" | "gulf" | "msa";
export type Fit = "cover" | "contain";

export interface Pt {
  x: number;
  y: number;
}

/** Reserved pixels against the placement's own canvas. */
export interface SafeBox {
  t: number;
  b: number;
  l: number;
  r: number;
}

export interface Placement {
  id: string;
  plat: string;
  name: string;
  w: number;
  h: number;
  safe: SafeBox;
  /** which chrome mock to draw */
  chrome: string;
  /** a right-hand icon column exists — matters for RTL copy */
  rail: boolean;
  maxMB: number;
  spec: Record<string, string>;
  bp: string[];
  /** profile grid squares this off */
  gridCrop?: boolean;
  /** the platform re-crops this asset to other ratios */
  multiCrop?: boolean;
}

export interface FontDef {
  id: string;
  label: string;
  css: string;
  weight: number;
  /** line height */
  lh: number;
}

export interface CopyPreset {
  brand: string;
  head: string;
  cta: string;
}

export interface BrandKit {
  brand: string;
  logo: string | null;
  headFont: string;
  headColor: string;
  /** the second headline colour, applied to [bracketed] words */
  headColor2: string;
  ctaBg: string;
  ctaInk: string;
}

/**
 * Everything that defines the layout, independent of the pixels behind it.
 * The design IS the layer list — there are no fixed headline/CTA/logo slots,
 * so "add another subheading" and "add a shape" are the same operation.
 */
export interface Design {
  /** the default fit; a placement can override it */
  fit: Fit;
  /** fitOverrides[placementId] — crop or letterbox is a per-channel decision */
  fitOverrides: Record<string, Fit>;
  lang: Lang;
  /** master switch: hide every layer at once to judge the artwork alone */
  copyOn: boolean;
  /** paint order, back to front */
  layers: Layer[];
  /**
   * Per-placement positions: overrides[placementId][layerId]. Dragging inside
   * one placement only ever writes here, so moving copy on TikTok cannot
   * silently break Snapchat.
   */
  overrides: Record<string, Record<string, Pt>>;
}

export interface CreativeMeta {
  name: string;
  bytes: number;
  w: number;
  h: number;
}

/** Everything about a design except the layers, which need the brand kit. */
export const DESIGN_BASE: Omit<Design, "layers"> = {
  fit: "cover",
  fitOverrides: {},
  lang: "en",
  copyOn: true,
  overrides: {},
};

/* ============================================================
   GENERATION — creative types and target shapes
   ============================================================ */

export interface CreativeType {
  id: string;
  label: string;
  blurb: string;
  /** the art-direction spine of the prompt for this type */
  direction: string;
  /** true when the format is normally shot with a person in frame */
  human: boolean;
}

export const CREATIVE_TYPES: CreativeType[] = [
  {
    id: "ugc",
    label: "UGC",
    blurb: "Looks filmed on a phone by a real customer.",
    human: true,
    direction:
      "Shot on a phone by a real person, not a photographer. Handheld framing, slightly off-centre subject, natural available light with visible imperfection, mild sensor noise, real domestic or street setting with lived-in clutter. Casual selfie or arm's-length framing. Nothing looks styled, lit or retouched. Avoid studio backdrops, rim lighting, perfect symmetry and stock-photo smiles.",
  },
  {
    id: "hero",
    label: "Product hero",
    blurb: "The product, lit and composed as the single subject.",
    human: false,
    direction:
      "Studio product photography. One subject, centred and clean, on a simple seamless background. Controlled directional light with a soft falloff and one crisp specular highlight. Shallow depth of field. Colour-graded, commercial polish, no background clutter, no text, no props competing with the subject.",
  },
  {
    id: "lifestyle",
    label: "Lifestyle",
    blurb: "The product in use, in a real place, styled.",
    human: true,
    direction:
      "Editorial lifestyle photography. The product in genuine use in a real location, person present but not posing at camera. Golden-hour or soft window light, natural colour, styled but not sterile. Composition leaves negative space for copy. Documentary feel with commercial finish.",
  },
  {
    id: "infographic",
    label: "Infographic",
    blurb: "Flat graphic panels built to carry numbers.",
    human: false,
    direction:
      "Flat vector-style graphic composition. Bold geometric shapes, generous negative space, strong figure-ground contrast, clean panel structure with obvious zones where numbers and short labels will be placed. No photographic texture, no gradients beyond a single flat duotone, no 3D bevels or drop shadows.",
  },
  {
    id: "social",
    label: "Social post",
    blurb: "Organic-looking post, not obviously an ad.",
    human: false,
    direction:
      "Looks like an organic brand post rather than paid media. Single clear idea, confident use of one flat brand colour as the ground, one photographic or illustrated element. Composed for a feed thumbnail — readable at 150px wide. No border, no frame, no fake UI.",
  },
  {
    id: "remake",
    label: "Ad remake",
    blurb: "Rebuild an existing creative in a new direction.",
    human: false,
    direction:
      "Rebuild the supplied reference image: keep its composition, subject placement and overall read, but replace the styling, palette and finish with the direction described. Match the reference's framing so the new version can be A/B tested against it.",
  },
  {
    id: "seasonal",
    label: "Seasonal drop",
    blurb: "Campaign-moment creative with a seasonal cue.",
    human: false,
    direction:
      "Campaign creative built around a seasonal or cultural moment. One unmistakable seasonal cue carried by colour, light and a single prop rather than by clip-art symbols. Composition leaves a clear quiet band for a headline. Restrained, premium, never novelty.",
  },
];

export interface ShapeDef {
  id: string;
  label: string;
  /** the size gpt-image renders natively */
  size: "1024x1024" | "1024x1536" | "1536x1024";
  /** the placement ratios this asset feeds */
  feeds: string;
  /** ratio of the native render, width / height */
  ratio: number;
}

export const SHAPES: ShapeDef[] = [
  {
    id: "vertical",
    label: "Vertical",
    size: "1024x1536",
    feeds: "9:16 stories and reels, 4:5 feed, 2:3 pins",
    ratio: 1024 / 1536,
  },
  {
    id: "square",
    label: "Square",
    size: "1024x1024",
    feeds: "1:1 feed, display and app campaigns",
    ratio: 1,
  },
  {
    id: "landscape",
    label: "Landscape",
    size: "1536x1024",
    feeds: "1.91:1 Discover, Gmail, X and LinkedIn",
    ratio: 1536 / 1024,
  },
];

export const MARKETS = [
  { id: "ksa", label: "Saudi Arabia", lang: "najdi" as Lang },
  { id: "uae", label: "UAE", lang: "gulf" as Lang },
  { id: "intl", label: "International", lang: "en" as Lang },
];

export const PLACEMENTS: Placement[] = [
  { id:"snap-single", plat:"Snapchat", name:"Single Image / Video Ad", w:1080, h:1920,
    safe:{t:150,b:350,l:64,r:64}, chrome:"snap", rail:false, maxMB:5,
    spec:{ "Canvas":"1080 × 1920 (9:16)", "Reserved":"top 150px · bottom 350px", "Max file":"5 MB image", "Headline":"34 characters", "Brand name":"25 characters" },
    bp:["Snapchat plays with sound on — design the frame to survive audio being the hook, not the caption.",
        "The bottom 350px is swipe-up furniture. Nothing you need read goes there.",
        "Brand cue inside the first 2 seconds; Snap users skip faster than any other feed.",
        "Full-bleed vertical only. A letterboxed 1:1 asset reads as a repurposed banner."] },

  { id:"snap-collection", plat:"Snapchat", name:"Collection Ad", w:1080, h:1920,
    safe:{t:150,b:700,l:64,r:64}, chrome:"snap", rail:false, maxMB:5,
    spec:{ "Canvas":"1080 × 1920 (9:16)", "Reserved":"top 150px · bottom 700px", "Max file":"5 MB image", "Extra":"4 product tiles pinned bottom" },
    bp:["Four product tiles eat the bottom 700px — the tightest 9:16 canvas you will design for.",
        "Keep the hero subject in the upper-middle third or the tiles will cover it.",
        "Product tiles carry their own imagery; do not repeat the products inside the creative."] },

  { id:"snap-commercial", plat:"Snapchat", name:"Commercial (6s non-skip)", w:1080, h:1920,
    safe:{t:150,b:250,l:64,r:64}, chrome:"snap", rail:false, maxMB:5,
    spec:{ "Canvas":"1080 × 1920 (9:16)", "Reserved":"top 150px · bottom 250px", "Length":"6s non-skippable segment", "Note":"No swipe-up attachment during the non-skip window" },
    bp:["No attachment furniture during the non-skippable window, so the bottom band is shallower than a Snap Ad.",
        "Six seconds guaranteed — the only Snap format where you can build to a payoff.",
        "Sonic branding is required: use the official CarSwitch jingle, not stock music."] },

  { id:"tiktok-infeed", plat:"TikTok", name:"In-Feed Ad", w:1080, h:1920,
    safe:{t:130,b:483,l:44,r:140}, chrome:"tiktok", rail:true, maxMB:30,
    spec:{ "Canvas":"1080 × 1920 (9:16)", "Reserved":"top 130 · bottom 483 · left 44 · right 140", "Ad text":"1–100 characters", "Display name":"1–40 characters" },
    bp:["The right 140px is the like/comment/share rail. Never park a logo there.",
        "Bottom 483px holds handle, ad text and CTA button — treat it as unusable.",
        "Sound-off legibility: burn captions in, but inside the safe box.",
        "Creative that looks made for TikTok outperforms polished film. Native beats produced."] },

  { id:"tiktok-spark", plat:"TikTok", name:"Spark Ad", w:1080, h:1920,
    safe:{t:130,b:600,l:44,r:140}, chrome:"tiktok", rail:true, maxMB:30,
    spec:{ "Canvas":"1080 × 1920 (9:16)", "Reserved":"top 130 · bottom 600 · left 44 · right 140", "Note":"Organic caption length is variable" },
    bp:["Spark Ads carry the real post caption, which can wrap to three lines — assume deeper bottom furniture than an In-Feed ad.",
        "Because the post is organic, the profile row sits higher. Test with your longest caption.",
        "Comments are visible and public. Plan for them."] },

  { id:"ig-reels", plat:"Instagram", name:"Reels", w:1080, h:1920,
    safe:{t:250,b:660,l:64,r:120}, chrome:"reels", rail:true, maxMB:30,
    spec:{ "Canvas":"1080 × 1920 (9:16)", "Reserved":"top 14% (250px) · bottom 35% (660px)", "Max file":"30 MB image", "Primary text":"72 characters before truncation" },
    bp:["Bottom 35% is the deepest reserved band in any placement — profile row, caption, audio and CTA all stack there.",
        "Meta crops Reels assets for other surfaces. Keep the message inside the centre square.",
        "Design for sound off, then reward sound on.",
        "Vertical 9:16 only; a 4:5 asset gets pillarboxed and looks bought."] },

  { id:"ig-stories", plat:"Instagram", name:"Stories", w:1080, h:1920,
    safe:{t:250,b:340,l:64,r:64}, chrome:"stories", rail:false, maxMB:30,
    spec:{ "Canvas":"1080 × 1920 (9:16)", "Reserved":"top 14% (250px) · bottom 20% (340px)", "Max file":"30 MB image", "Note":"Stickers and replies also sit low" },
    bp:["Top 250px carries progress bars, avatar and the Sponsored label.",
        "Bottom 340px is the swipe-up / CTA chevron zone.",
        "Interactive stickers land low too — leave the lower third genuinely clear.",
        "One idea per frame. Stories are held for under 2 seconds on average."] },

  { id:"ig-feed", plat:"Instagram", name:"Feed 4:5", w:1080, h:1350,
    safe:{t:54,b:54,l:54,r:54}, chrome:"igfeed", rail:false, maxMB:30, gridCrop:true,
    spec:{ "Canvas":"1080 × 1350 (4:5)", "Reserved":"48–54px breathing margin", "Max file":"30 MB", "Profile grid":"Cropped to 1:1", "Primary text":"125 characters before More" },
    bp:["4:5 is the tallest ratio the feed allows — take the extra height, it is free reach.",
        "Your profile grid crops this to a centre square. Check the square before you post.",
        "No platform chrome overlaps the image here, so the risk is edge-crowding, not collision.",
        "Text-in-image is no longer rejected, but under 20% coverage still reads cleaner."] },

  { id:"fb-reels", plat:"Facebook", name:"Reels", w:1080, h:1920,
    safe:{t:250,b:660,l:64,r:120}, chrome:"reels", rail:true, maxMB:30,
    spec:{ "Canvas":"1080 × 1920 (9:16)", "Reserved":"top 14% · bottom 35%", "Max file":"30 MB image" },
    bp:["Same geometry as Instagram Reels, older audience skew — legibility matters more, so size type up.",
        "Facebook Reels shows a longer page name; the profile row can wrap."] },

  { id:"fb-stories", plat:"Facebook", name:"Stories", w:1080, h:1920,
    safe:{t:250,b:380,l:64,r:64}, chrome:"stories", rail:false, maxMB:30,
    spec:{ "Canvas":"1080 × 1920 (9:16)", "Reserved":"top 14% · bottom 20%", "Max file":"30 MB image" },
    bp:["Reserve slightly deeper at the bottom than Instagram Stories — the CTA bar is taller.",
        "Facebook Stories inherits the feed CTA label set; write to those verbs."] },

  { id:"fb-feed", plat:"Facebook", name:"Feed 4:5", w:1080, h:1350,
    safe:{t:54,b:54,l:54,r:54}, chrome:"fbfeed", rail:false, maxMB:30,
    spec:{ "Canvas":"1080 × 1350 (4:5)", "Reserved":"48–54px breathing margin", "Max file":"30 MB", "Headline":"27 characters recommended", "Link description":"27 characters" },
    bp:["The headline and CTA render in a card below the image — do not duplicate them inside the artwork.",
        "Some surfaces crop the feed asset to 1:1. Keep the message centre-weighted.",
        "Right-column and Marketplace placements reuse this asset tiny. Test legibility at 120px wide."] },

  { id:"yt-shorts", plat:"YouTube", name:"Shorts", w:1080, h:1920,
    safe:{t:140,b:480,l:64,r:130}, chrome:"shorts", rail:true, maxMB:30,
    spec:{ "Canvas":"1080 × 1920 (9:16)", "Reserved":"top 140 · bottom 480 · right 130", "Note":"Channel row and title sit bottom-left" },
    bp:["Hook inside the first second — Shorts autoplays into a scroll.",
        "Right 130px is the action rail; bottom 480px is channel, title and CTA.",
        "Shorts assets get reused as in-stream. Check the centre 16:9 crop holds."] },

  { id:"goog-dg-portrait", plat:"Google", name:"Demand Gen 4:5", w:960, h:1200,
    safe:{t:60,b:280,l:60,r:60}, chrome:"google", rail:false, maxMB:5, multiCrop:true,
    spec:{ "Canvas":"960 × 1200 (4:5)", "Reserved":"bottom 280px overlay · 60px margins", "Max file":"5 MB", "Headline":"40 characters", "Description":"90 characters", "Also required":"1.91:1 and 1:1 versions" },
    bp:["Google re-crops one asset across 4:5, 1:1 and 1.91:1 surfaces. Only the centre square is guaranteed.",
        "Headline, description and CTA are drawn by Google — keep that area quiet.",
        "Upload a separate logo asset (1:1 and 4:1). Never bake the logo into the image.",
        "Avoid heavy text in the image; it survives none of the crops cleanly."] },

  { id:"goog-dg-land", plat:"Google", name:"Demand Gen 1.91:1", w:1200, h:628,
    safe:{t:40,b:40,l:60,r:60}, chrome:"google", rail:false, maxMB:5, multiCrop:true,
    spec:{ "Canvas":"1200 × 628 (1.91:1)", "Reserved":"40px top/bottom · 60px sides", "Max file":"5 MB", "Headline":"40 characters", "Business name":"25 characters" },
    bp:["The Discover and Gmail workhorse. Text sits outside the image, so the image must carry meaning alone.",
        "Landscape assets get further cropped to 1:1 on some surfaces — centre the subject.",
        "One clear focal point. At Gmail inline sizes there is room for nothing else."] },

  { id:"goog-square", plat:"Google", name:"Display 1:1", w:1200, h:1200,
    safe:{t:60,b:60,l:60,r:60}, chrome:"google", rail:false, maxMB:5, multiCrop:true,
    spec:{ "Canvas":"1200 × 1200 (1:1)", "Reserved":"60px margins", "Max file":"5 MB", "Text in image":"Under 20% recommended" },
    bp:["Responsive Display renders this from 300px to full width. Legibility at 300px is the bar.",
        "Google may add its own text and CTA layer. Leave one quiet edge.",
        "Supply logo separately at 1:1 and 4:1 or Google will letterbox a guess."] },

  { id:"goog-app", plat:"Google", name:"App Campaign 1:1", w:1200, h:1200,
    safe:{t:60,b:230,l:60,r:60}, chrome:"appcamp", rail:false, maxMB:5, multiCrop:true,
    spec:{ "Canvas":"1200 × 1200 (1:1)", "Reserved":"bottom 230px install bar · 60px margins", "Max file":"5 MB", "Also supply":"1.91:1 landscape and 4:5 portrait", "Note":"App icon and Install button are drawn by Google" },
    bp:["The app icon and Install button are composited over the bottom of the asset — never put copy there.",
        "App Campaigns auto-combine assets. Every image must stand alone with no headline.",
        "Push the app, not the website — this format exists to drive installs.",
        "Supply at least one asset per ratio or Google will crop the one you gave it."] },

  { id:"pin-standard", plat:"Pinterest", name:"Standard Pin 2:3", w:1000, h:1500,
    safe:{t:120,b:160,l:60,r:60}, chrome:"pinterest", rail:false, maxMB:20,
    spec:{ "Canvas":"1000 × 1500 (2:3)", "Reserved":"top 120px Save button · bottom 160px title", "Max file":"20 MB", "Title":"100 characters", "Description":"500 characters" },
    bp:["2:3 is the only ratio Pinterest shows in full. Taller pins get truncated mid-image.",
        "The Save button floats top-right; the title strip sits under or over the bottom edge.",
        "Pinterest is a search surface — a readable text overlay genuinely helps here, unlike TikTok.",
        "Vertical text overlays in the middle third survive every Pinterest surface."] },

  { id:"pin-idea", plat:"Pinterest", name:"Idea Pin 9:16", w:1080, h:1920,
    safe:{t:200,b:400,l:64,r:64}, chrome:"stories", rail:false, maxMB:20,
    spec:{ "Canvas":"1080 × 1920 (9:16)", "Reserved":"top 200px · bottom 400px", "Max file":"20 MB per page", "Pages":"Up to 20" },
    bp:["Page indicator sits top; creator row and title sit bottom — deeper than Stories.",
        "Idea Pins are held longer than Stories. You can afford a second beat of information."] },

  { id:"x-land", plat:"X", name:"Image Ad 1.91:1", w:1200, h:628,
    safe:{t:40,b:40,l:50,r:50}, chrome:"xpost", rail:false, maxMB:5,
    spec:{ "Canvas":"1200 × 628 (1.91:1)", "Reserved":"40px top/bottom · 50px sides", "Max file":"5 MB image", "Post text":"280 characters" },
    bp:["Post copy sits above the image, so the image does not need a headline baked in.",
        "In-timeline the card is cropped to roughly 16:9 — keep the subject off the vertical edges.",
        "X compresses hard. Flat colour and heavy type survive; fine gradients band."] },

  { id:"x-square", plat:"X", name:"Image Ad 1:1", w:1200, h:1200,
    safe:{t:50,b:50,l:50,r:50}, chrome:"xpost", rail:false, maxMB:5,
    spec:{ "Canvas":"1200 × 1200 (1:1)", "Reserved":"50px margins", "Max file":"5 MB image" },
    bp:["Square takes more vertical timeline space than landscape — worth the extra attention.",
        "Multi-image posts crop squares aggressively. Single image only if the layout is tight."] },

  { id:"li-land", plat:"LinkedIn", name:"Single Image 1.91:1", w:1200, h:627,
    safe:{t:40,b:40,l:60,r:60}, chrome:"lipost", rail:false, maxMB:5,
    spec:{ "Canvas":"1200 × 627 (1.91:1)", "Reserved":"40px top/bottom · 60px sides", "Max file":"5 MB", "Intro text":"150 characters before More", "Headline":"70 characters" },
    bp:["Intro text and headline render outside the image — the image carries the visual, not the offer.",
        "LinkedIn is viewed on desktop far more than the others. Fine detail actually survives here.",
        "Keep it credible over playful; the brand book's casual register still applies but dialled down."] },

  { id:"li-square", plat:"LinkedIn", name:"Single Image 1:1", w:1200, h:1200,
    safe:{t:60,b:60,l:60,r:60}, chrome:"lipost", rail:false, maxMB:5,
    spec:{ "Canvas":"1200 × 1200 (1:1)", "Reserved":"60px margins", "Max file":"5 MB" },
    bp:["Square outperforms landscape on LinkedIn mobile by taking more feed height.",
        "Document and carousel ads reuse this ratio — build it once, use it three ways."] },

  { id:"li-portrait", plat:"LinkedIn", name:"Single Image 4:5", w:1080, h:1350,
    safe:{t:54,b:54,l:54,r:54}, chrome:"lipost", rail:false, maxMB:5,
    spec:{ "Canvas":"1080 × 1350 (4:5)", "Reserved":"54px margins", "Max file":"5 MB" },
    bp:["The tallest ratio LinkedIn serves. Same asset as Meta 4:5, so it is nearly free to add.",
        "Desktop crops portrait less aggressively than mobile crops landscape."] }
];

/* Headline fonts offered in the picker (all loaded from Google Fonts above) */
export const FONTS: FontDef[] = [
  { id:"jakarta", label:"Plus Jakarta Sans — brand", css:"'Plus Jakarta Sans', sans-serif", weight:800, lh:1.14 },
  { id:"anton",   label:"Anton — impact",           css:"'Anton', sans-serif",            weight:400, lh:1.06 },
  { id:"bebas",   label:"Bebas Neue — condensed",   css:"'Bebas Neue', sans-serif",       weight:400, lh:1.02 },
  { id:"cairo",   label:"Cairo — Arabic + Latin",   css:"'Cairo', sans-serif",            weight:900, lh:1.4  },
  { id:"kufi",    label:"Noto Kufi Arabic",         css:"'Noto Kufi Arabic', sans-serif", weight:700, lh:1.45 },
  { id:"plexar",  label:"IBM Plex Sans Arabic",     css:"'IBM Plex Sans Arabic', sans-serif", weight:700, lh:1.4 }
];
export const FONT = (id: string): FontDef => FONTS.find(f => f.id === id) || FONTS[0];

/* CarSwitch swatches offered under every colour picker */
export const BRAND_SWATCHES: [string, string][] = [
  ["#141652","Night Sky"], ["#0038A7","Night Sky bright"], ["#0454F2","Night Sky 60%"],
  ["#FF5450","Sunset"], ["#FF7A77","Sunset 60%"], ["#BFFF00","Fields"], ["#D3FF4E","Fields 60%"],
  ["#FFFFFF","Air"], ["#1C1D26","Asphalt"]
];

/* Copy presets. Arabic is written to register, not machine-translated:
   Najdi for KSA, general Khaleeji for UAE, MSA only as a formal fallback. */
export const PRESETS: Record<Lang, CopyPreset> = {
  en:    { brand:"CarSwitch", head:"Let us take over",       cta:"Download the app" },
  najdi: { brand:"كارسويتش", head:"خليها علينا",             cta:"نزّل التطبيق" },
  gulf:  { brand:"كارسويتش", head:"خلّها علينا",             cta:"حمّل التطبيق" },
  msa:   { brand:"كارسويتش", head:"دعنا نتولى الأمر",        cta:"حمّل التطبيق" }
};
export const isRTL = (l: Lang): boolean => l !== "en";

export const KIT_DEFAULTS: BrandKit = {
  brand:"CarSwitch", logo:null, headFont:"jakarta",
  headColor:"#FFFFFF", headColor2:"#BFFF00", ctaBg:"#BFFF00", ctaInk:"#141652"
};
export const KIT_KEY = "ps.brandkit.v1";
