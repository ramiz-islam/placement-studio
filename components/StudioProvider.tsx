"use client";

/**
 * One store for the whole studio. A single state object with a `patch`
 * updater — deliberately boring, so the flow is readable end to end rather
 * than spread across a dozen reducers.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  DESIGN_BASE,
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
import {
  bandLayer,
  ctaLayer,
  defaultStack,
  iconLayer,
  logoLayer,
  shapeLayer,
  textLayer,
  type Layer,
  type LayerKind,
  type NewLayerDefaults,
} from "@/lib/layers";
import { clearAnalysisCache, samplePad } from "@/lib/analysis";
import { masterZone, safeF, stackInside, type LayoutContext } from "@/lib/geometry";

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
  /** rounded phone shell, off by default — the grid should show the real frame */
  deviceFrame: boolean;
  selectedId: string | null;
  toast: string | null;
}

export interface Studio extends StudioState {
  placement: Placement;
  ctx: LayoutContext;
  patch: (p: Partial<StudioState>) => void;
  patchDesign: (p: Partial<Design>) => void;
  loadCreative: (src: string, name: string, bytes: number) => void;
  loadLogo: (src: string, persist?: boolean) => void;
  clearLogo: () => void;
  setLang: (l: Lang) => void;
  applyKit: (k: BrandKit, persist?: boolean) => void;
  forgetKit: () => void;
  /* ---- layers ---- */
  addLayer: (kind: LayerKind | "band") => void;
  updateLayer: (id: string, p: Partial<Layer>) => void;
  removeLayer: (id: string) => void;
  duplicateLayer: (id: string) => void;
  reorderLayer: (id: string, dir: -1 | 1) => void;
  select: (id: string | null) => void;
  /** move one layer on ONE placement only */
  moveLayer: (placementId: string, layerId: string, x: number, y: number) => void;
  snapThis: () => void;
  snapAllToMaster: () => void;
  applyToAll: () => void;
  resetThis: () => void;
  reset: () => void;
  say: (msg: string) => void;
  kitReady: boolean;
}

const Ctx = createContext<Studio | null>(null);

const kitDefaults = (kit: BrandKit): NewLayerDefaults => ({
  font: kit.headFont,
  color: kit.headColor,
  color2: kit.headColor2,
  ctaBg: kit.ctaBg,
  ctaInk: kit.ctaInk,
});

const initialDesign = (kit: BrandKit): Design => ({
  ...DESIGN_BASE,
  layers: defaultStack(kitDefaults(kit), kit.brand, PRESETS.en.head, PRESETS.en.cta),
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
    deviceFrame: false,
    selectedId: null,
    toast: null,
  }));
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

  /* ---------- brand kit ---------- */
  const applyKit = useCallback((k: BrandKit, persist = true) => {
    if (persist) {
      try {
        localStorage.setItem(KIT_KEY, JSON.stringify(k));
      } catch {
        /* quota — the kit still applies for this session */
      }
    }
    setS(prev => ({ ...prev, kit: k }));
    if (k.logo) loadLogoInto(setS, k.logo);
    else setS(prev => ({ ...prev, logo: null, logoSrc: null }));
  }, []);

  useEffect(() => {
    let saved: BrandKit | null = null;
    try {
      const raw = localStorage.getItem(KIT_KEY);
      if (raw) saved = { ...KIT_DEFAULTS, ...(JSON.parse(raw) as Partial<BrandKit>) };
    } catch {
      saved = null;
    }
    if (saved) {
      const kit = saved;
      setS(prev => ({ ...prev, kit, design: initialDesign(kit) }));
      if (kit.logo) loadLogoInto(setS, kit.logo);
    }
    setKitReady(true);
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

  const loadLogo = useCallback((src: string, persist = true) => {
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
  }, []);

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

  /* ---------- language ----------
     Swap only the text that is still a preset; anything the user has written
     is theirs and stays put. */
  const setLang = useCallback((lang: Lang) => {
    setS(prev => {
      const pr = PRESETS[lang];
      const known = (v: string) => Object.values(PRESETS).some(p => Object.values(p).includes(v.trim()));
      const rtl = isRTL(lang);
      let headDone = false;
      const layers = prev.design.layers.map(l => {
        if (l.kind === "cta") return known(l.text) ? { ...l, text: pr.cta } : l;
        if (l.kind !== "text") return l;
        if (!known(l.text)) return l;
        // Plus Jakarta Sans has no Arabic coverage
        const font = rtl && l.font === "jakarta" ? "cairo" : l.font;
        if (!headDone && l.text.trim() === prev.kit.brand.trim()) return { ...l, font, text: rtl ? pr.brand : prev.kit.brand };
        if (!headDone) {
          headDone = true;
          return { ...l, font, text: pr.head };
        }
        return { ...l, font };
      });
      return { ...prev, design: { ...prev.design, lang, layers } };
    });
  }, []);

  /* ---------- layers ---------- */
  const addLayer = useCallback(
    (kind: LayerKind | "band") => {
      setS(prev => {
        const d = kitDefaults(prev.kit);
        const made: Layer =
          kind === "text"
            ? textLayer(d, { name: `Text ${prev.design.layers.filter(l => l.kind === "text").length + 1}` })
            : kind === "cta"
              ? ctaLayer(d)
              : kind === "logo"
                ? logoLayer()
                : kind === "icon"
                  ? iconLayer()
                  : kind === "band"
                    ? bandLayer()
                    : shapeLayer();
        return {
          ...prev,
          selectedId: made.id,
          design: { ...prev.design, layers: [...prev.design.layers, made] },
        };
      });
      say(`${kind === "band" ? "Band" : kind} layer added`);
    },
    [say]
  );

  const updateLayer = useCallback((id: string, p: Partial<Layer>) => {
    setS(prev => ({
      ...prev,
      design: {
        ...prev.design,
        layers: prev.design.layers.map(l => (l.id === id ? ({ ...l, ...p } as Layer) : l)),
      },
    }));
  }, []);

  const removeLayer = useCallback((id: string) => {
    setS(prev => {
      const overrides: Design["overrides"] = {};
      for (const [plId, per] of Object.entries(prev.design.overrides)) {
        const copy = { ...per };
        delete copy[id];
        if (Object.keys(copy).length) overrides[plId] = copy;
      }
      return {
        ...prev,
        selectedId: prev.selectedId === id ? null : prev.selectedId,
        design: { ...prev.design, layers: prev.design.layers.filter(l => l.id !== id), overrides },
      };
    });
  }, []);

  const duplicateLayer = useCallback((id: string) => {
    setS(prev => {
      const i = prev.design.layers.findIndex(l => l.id === id);
      if (i === -1) return prev;
      const src = prev.design.layers[i];
      const copy = {
        ...src,
        id: `${src.kind}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
        name: `${src.name} copy`,
        pos: { x: src.pos.x + 0.03, y: src.pos.y + 0.03 },
      } as Layer;
      const layers = [...prev.design.layers];
      layers.splice(i + 1, 0, copy);
      return { ...prev, selectedId: copy.id, design: { ...prev.design, layers } };
    });
  }, []);

  const reorderLayer = useCallback((id: string, dir: -1 | 1) => {
    setS(prev => {
      const layers = [...prev.design.layers];
      const i = layers.findIndex(l => l.id === id);
      const j = i + dir;
      if (i === -1 || j < 0 || j >= layers.length) return prev;
      [layers[i], layers[j]] = [layers[j], layers[i]];
      return { ...prev, design: { ...prev.design, layers } };
    });
  }, []);

  const select = useCallback((id: string | null) => setS(prev => ({ ...prev, selectedId: id })), []);

  /* ---------- positions ----------
     A drag is local by definition: it writes an override for the placement it
     happened on and touches nothing else. Pushing a layout everywhere is an
     explicit action, never a side effect. */
  const moveLayer = useCallback((placementId: string, layerId: string, x: number, y: number) => {
    setS(prev => ({
      ...prev,
      design: {
        ...prev.design,
        overrides: {
          ...prev.design.overrides,
          [placementId]: { ...(prev.design.overrides[placementId] ?? {}), [layerId]: { x, y } },
        },
      },
    }));
  }, []);

  const ctxOf = (st: StudioState): LayoutContext => ({
    lang: st.design.lang,
    logoAspect: st.logo ? st.logo.naturalHeight / st.logo.naturalWidth : 0.3,
  });

  const snapThis = useCallback(() => {
    setS(prev => {
      const pl = PLACEMENTS.find(p => p.id === prev.active) ?? PLACEMENTS[0];
      const next = stackInside(pl, prev.design, safeF(pl), ctxOf(prev));
      return {
        ...prev,
        design: { ...prev.design, overrides: { ...prev.design.overrides, [pl.id]: next } },
      };
    });
    say("Snapped into this placement's safe box");
  }, [say]);

  const snapAllToMaster = useCallback(() => {
    setS(prev => {
      const pl = PLACEMENTS.find(p => p.id === prev.active) ?? PLACEMENTS[0];
      const next = stackInside(pl, prev.design, masterZone(pl, PLACEMENTS), ctxOf(prev));
      return {
        ...prev,
        design: {
          ...prev.design,
          layers: prev.design.layers.map(l => (next[l.id] ? { ...l, pos: next[l.id] } : l)),
          overrides: {},
        },
      };
    });
    say("Master layout applied to every placement");
  }, [say]);

  const applyToAll = useCallback(() => {
    setS(prev => {
      const per = prev.design.overrides[prev.active] ?? {};
      return {
        ...prev,
        design: {
          ...prev.design,
          layers: prev.design.layers.map(l => (per[l.id] ? { ...l, pos: per[l.id] } : l)),
          overrides: {},
        },
      };
    });
    say("This position is now the default everywhere");
  }, [say]);

  const resetThis = useCallback(() => {
    setS(prev => {
      const overrides = { ...prev.design.overrides };
      delete overrides[prev.active];
      return { ...prev, design: { ...prev.design, overrides } };
    });
    say("Back to the shared default");
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
      selectedId: null,
      design: initialDesign(prev.kit),
    }));
    say("Cleared — brand kit kept");
  }, [say]);

  const placement = useMemo(() => PLACEMENTS.find(p => p.id === s.active) ?? PLACEMENTS[0], [s.active]);
  const ctx = useMemo<LayoutContext>(
    () => ({ lang: s.design.lang, logoAspect: s.logo ? s.logo.naturalHeight / s.logo.naturalWidth : 0.3 }),
    [s.design.lang, s.logo]
  );

  const value: Studio = {
    ...s,
    placement,
    ctx,
    patch,
    patchDesign,
    loadCreative,
    loadLogo,
    clearLogo,
    setLang,
    applyKit,
    forgetKit,
    addLayer,
    updateLayer,
    removeLayer,
    duplicateLayer,
    reorderLayer,
    select,
    moveLayer,
    snapThis,
    snapAllToMaster,
    applyToAll,
    resetThis,
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
