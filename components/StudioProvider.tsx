"use client";

/**
 * One store for the whole studio. A single state object with a `patch`
 * updater — deliberately boring, so the flow is readable end to end rather
 * than spread across a dozen reducers.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  DESIGN_DEFAULTS,
  KIT_DEFAULTS,
  KIT_KEY,
  PLACEMENTS,
  PRESETS,
  isRTL,
  type BrandKit,
  type CreativeMeta,
  type Design,
  type Lang,
  type Placement,
} from "@/lib/core";
import { clearAnalysisCache, samplePad } from "@/lib/analysis";
import { masterZone, safeF, snapped } from "@/lib/geometry";

export interface StudioState {
  img: HTMLImageElement | null;
  src: string | null;
  meta: CreativeMeta | null;
  padColor: string;
  ver: number;
  logo: HTMLImageElement | null;
  logoSrc: string | null;
  design: Design;
  kit: BrandKit;
  view: "focus" | "grid";
  active: string;
  plat: string;
  zones: boolean;
  flags: boolean;
  chrome: boolean;
  toast: string | null;
}

export interface Studio extends StudioState {
  placement: Placement;
  patch: (p: Partial<StudioState>) => void;
  patchDesign: (p: Partial<Design>) => void;
  loadCreative: (src: string, name: string, bytes: number) => void;
  loadLogo: (src: string, persist?: boolean) => void;
  clearLogo: () => void;
  setLang: (l: Lang) => void;
  applyKit: (k: BrandKit, persist?: boolean) => void;
  forgetKit: () => void;
  snap: (toMaster: boolean) => void;
  reset: () => void;
  say: (msg: string) => void;
  kitReady: boolean;
}

const Ctx = createContext<Studio | null>(null);

const initialDesign = (kit: BrandKit): Design => ({
  ...DESIGN_DEFAULTS,
  brand: kit.brand,
  head: PRESETS.en.head,
  cta: PRESETS.en.cta,
  headFont: kit.headFont,
  headColor: kit.headColor,
  ctaBg: kit.ctaBg,
  ctaInk: kit.ctaInk,
});

export function StudioProvider({ children }: { children: React.ReactNode }) {
  const [s, setS] = useState<StudioState>(() => ({
    img: null,
    src: null,
    meta: null,
    padColor: "#07080E",
    ver: 0,
    logo: null,
    logoSrc: null,
    design: initialDesign(KIT_DEFAULTS),
    kit: KIT_DEFAULTS,
    view: "focus",
    active: PLACEMENTS[0].id,
    plat: PLACEMENTS[0].plat,
    zones: true,
    flags: true,
    chrome: true,
    toast: null,
  }));
  // false until we know whether a kit was saved — gates the first-run sheet
  const [kitReady, setKitReady] = useState(false);

  const patch = useCallback((p: Partial<StudioState>) => setS(prev => ({ ...prev, ...p })), []);
  const patchDesign = useCallback(
    (p: Partial<Design>) => setS(prev => ({ ...prev, design: { ...prev.design, ...p } })),
    []
  );

  const say = useCallback((msg: string) => {
    setS(prev => ({ ...prev, toast: msg }));
    window.setTimeout(() => setS(prev => (prev.toast === msg ? { ...prev, toast: null } : prev)), 2600);
  }, []);

  /* ---------- brand kit persistence ---------- */
  const applyKit = useCallback(
    (k: BrandKit, persist = true) => {
      if (persist) {
        try {
          localStorage.setItem(KIT_KEY, JSON.stringify(k));
        } catch {
          /* quota — the kit still applies for this session */
        }
      }
      setS(prev => ({
        ...prev,
        kit: k,
        design: {
          ...prev.design,
          headFont: k.headFont,
          headColor: k.headColor,
          ctaBg: k.ctaBg,
          ctaInk: k.ctaInk,
          brand: isRTL(prev.design.lang) ? prev.design.brand : k.brand,
        },
      }));
      if (k.logo) loadLogoInto(setS, k.logo);
      else setS(prev => ({ ...prev, logo: null, logoSrc: null }));
    },
    []
  );

  useEffect(() => {
    let saved: BrandKit | null = null;
    try {
      const raw = localStorage.getItem(KIT_KEY);
      if (raw) saved = { ...KIT_DEFAULTS, ...(JSON.parse(raw) as Partial<BrandKit>) };
    } catch {
      saved = null;
    }
    if (saved) applyKit(saved, false);
    setKitReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const forgetKit = useCallback(() => {
    try {
      localStorage.removeItem(KIT_KEY);
    } catch {
      /* nothing to remove */
    }
    applyKit(KIT_DEFAULTS, false);
    say("Saved kit forgotten — back to CarSwitch defaults");
  }, [applyKit, say]);

  /* ---------- creative + logo ---------- */
  const loadCreative = useCallback(
    (src: string, name: string, bytes: number) => {
      const img = new Image();
      img.onload = () => {
        clearAnalysisCache();
        setS(prev => ({
          ...prev,
          img,
          src,
          meta: { name, bytes, w: img.naturalWidth, h: img.naturalHeight },
          padColor: samplePad(img),
          ver: prev.ver + 1,
        }));
        say(`Scored across ${PLACEMENTS.length} placements`);
      };
      img.onerror = () => say("That file could not be read as an image");
      img.src = src;
    },
    [say]
  );

  const loadLogo = useCallback(
    (src: string, persist = true) => {
      loadLogoInto(setS, src);
      if (persist) {
        setS(prev => {
          const k = { ...prev.kit, logo: src };
          try {
            localStorage.setItem(KIT_KEY, JSON.stringify(k));
          } catch {
            /* logo too large to persist; still active this session */
          }
          return { ...prev, kit: k };
        });
      }
    },
    []
  );

  const clearLogo = useCallback(() => {
    setS(prev => {
      const k = { ...prev.kit, logo: null };
      try {
        localStorage.setItem(KIT_KEY, JSON.stringify(k));
      } catch {
        /* ignore */
      }
      return { ...prev, logo: null, logoSrc: null, kit: k };
    });
  }, []);

  /* ---------- language ---------- */
  const setLang = useCallback((lang: Lang) => {
    setS(prev => {
      const pr = PRESETS[lang];
      const rtl = isRTL(lang);
      const known = (v: string) => Object.values(PRESETS).some(p => Object.values(p).includes(v));
      const d = prev.design;
      return {
        ...prev,
        design: {
          ...d,
          lang,
          brand: known(d.brand) || d.brand === prev.kit.brand ? (rtl ? pr.brand : prev.kit.brand) : d.brand,
          head: known(d.head) || !d.head ? pr.head : d.head,
          cta: known(d.cta) || !d.cta ? pr.cta : d.cta,
          // Plus Jakarta Sans has no Arabic coverage
          headFont: rtl && d.headFont === "jakarta" ? "cairo" : d.headFont,
        },
      };
    });
  }, []);

  /* ---------- snap ---------- */
  const snap = useCallback((toMaster: boolean) => {
    setS(prev => {
      const pl = PLACEMENTS.find(p => p.id === prev.active) || PLACEMENTS[0];
      const zone = toMaster ? masterZone(pl, PLACEMENTS) : safeF(pl);
      const aspect = prev.logo ? prev.logo.naturalHeight / prev.logo.naturalWidth : 0.3;
      return { ...prev, design: { ...prev.design, layers: snapped(pl, prev.design, zone, aspect) } };
    });
    say(toMaster ? "Snapped into the master safe zone" : "Snapped into this placement's safe box");
  }, [say]);

  const reset = useCallback(() => {
    clearAnalysisCache();
    setS(prev => ({
      ...prev,
      img: null,
      src: null,
      meta: null,
      ver: prev.ver + 1,
      view: "focus",
      active: PLACEMENTS[0].id,
      plat: PLACEMENTS[0].plat,
      design: initialDesign(prev.kit),
    }));
    say("Cleared — brand kit kept");
  }, [say]);

  const placement = useMemo(() => PLACEMENTS.find(p => p.id === s.active) || PLACEMENTS[0], [s.active]);

  const value: Studio = {
    ...s,
    placement,
    patch,
    patchDesign,
    loadCreative,
    loadLogo,
    clearLogo,
    setLang,
    applyKit,
    forgetKit,
    snap,
    reset,
    say,
    kitReady,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function loadLogoInto(setS: React.Dispatch<React.SetStateAction<StudioState>>, src: string) {
  const img = new Image();
  img.onload = () => setS(prev => ({ ...prev, logo: img, logoSrc: src }));
  img.src = src;
}

export function useStudio(): Studio {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStudio must be used inside StudioProvider");
  return v;
}

/** Shrink an image so a logo can live in localStorage without blowing the quota. */
export function shrinkImage(src: string, maxW: number): Promise<string> {
  return new Promise(resolve => {
    const im = new Image();
    im.onload = () => {
      const s = Math.min(1, maxW / im.naturalWidth);
      const c = document.createElement("canvas");
      c.width = Math.round(im.naturalWidth * s);
      c.height = Math.round(im.naturalHeight * s);
      c.getContext("2d")!.drawImage(im, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/png"));
    };
    im.onerror = () => resolve(src);
    im.src = src;
  });
}
