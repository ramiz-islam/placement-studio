"use client";

/**
 * One store for the whole studio.
 *
 * Every change to the design goes through `commit(tag, fn)`, which is also what
 * makes undo work: it snapshots the previous design before applying the new
 * one. Rapid edits carrying the same tag — a slider being dragged — collapse
 * into a single history entry, so one undo takes you back to before the drag
 * rather than one pixel at a time.
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
  type Fit,
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
import { fitFor, masterZone, safeF, stackInside, type LayoutContext } from "@/lib/geometry";

const HISTORY_LIMIT = 30;
/** edits with the same tag inside this window collapse into one undo step */
const COALESCE_MS = 700;

interface HistEntry {
  design: Design;
  tag: string;
  at: number;
}

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
  past: HistEntry[];
  future: Design[];
  toast: string | null;
}

export interface Studio extends StudioState {
  placement: Placement;
  ctx: LayoutContext;
  /** the fit this placement actually uses */
  fit: Fit;
  patch: (p: Partial<StudioState>) => void;
  patchDesign: (p: Partial<Design>, tag?: string) => void;
  loadCreative: (src: string, name: string, bytes: number) => void;
  loadLogo: (src: string, persist?: boolean) => void;
  clearLogo: () => void;
  setLang: (l: Lang) => void;
  applyKit: (k: BrandKit, persist?: boolean) => void;
  forgetKit: () => void;
  /* ---- fit, per channel ---- */
  setFitDefault: (f: Fit) => void;
  setFitHere: (f: Fit) => void;
  resetFitHere: () => void;
  applyFitEverywhere: () => void;
  /* ---- layers ---- */
  addLayer: (kind: LayerKind | "band") => void;
  updateLayer: (id: string, p: Partial<Layer>, tag?: string) => void;
  removeLayer: (id: string) => void;
  duplicateLayer: (id: string) => void;
  reorderLayer: (id: string, dir: -1 | 1) => void;
  select: (id: string | null) => void;
  moveLayer: (placementId: string, layerId: string, x: number, y: number) => void;
  snapThis: () => void;
  snapAllToMaster: () => void;
  applyToAll: () => void;
  resetThis: () => void;
  /* ---- history ---- */
  undo: () => void;
  redo: () => void;
  canUndo: number;
  canRedo: number;
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
    past: [],
    future: [],
    toast: null,
  }));
  const [kitReady, setKitReady] = useState(false);

  const patch = useCallback((p: Partial<StudioState>) => setS(prev => ({ ...prev, ...p })), []);

  const say = useCallback((msg: string) => {
    setS(prev => ({ ...prev, toast: msg }));
    window.setTimeout(() => setS(prev => (prev.toast === msg ? { ...prev, toast: null } : prev)), 2600);
  }, []);

  /* ---------- the one path every design change takes ---------- */
  const commit = useCallback((tag: string, fn: (d: Design) => Design, extra?: Partial<StudioState>) => {
    setS(prev => {
      const next = fn(prev.design);
      if (next === prev.design) return extra ? { ...prev, ...extra } : prev;
      const now = Date.now();
      const last = prev.past[prev.past.length - 1];
      const coalesce = Boolean(last && last.tag === tag && now - last.at < COALESCE_MS);
      const past = coalesce
        ? prev.past.slice(0, -1).concat({ ...last!, at: now })
        : [...prev.past, { design: prev.design, tag, at: now }].slice(-HISTORY_LIMIT);
      return { ...prev, ...extra, design: next, past, future: [] };
    });
  }, []);

  const undo = useCallback(() => {
    setS(prev => {
      const last = prev.past[prev.past.length - 1];
      if (!last) return prev;
      return {
        ...prev,
        design: last.design,
        past: prev.past.slice(0, -1),
        future: [prev.design, ...prev.future].slice(0, HISTORY_LIMIT),
      };
    });
  }, []);

  const redo = useCallback(() => {
    setS(prev => {
      const [next, ...rest] = prev.future;
      if (!next) return prev;
      return {
        ...prev,
        design: next,
        past: [...prev.past, { design: prev.design, tag: "redo", at: Date.now() }].slice(-HISTORY_LIMIT),
        future: rest,
      };
    });
  }, []);

  const patchDesign = useCallback(
    (p: Partial<Design>, tag = "design") => commit(tag, d => ({ ...d, ...p })),
    [commit]
  );

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
      setS(prev => ({ ...prev, kit, design: initialDesign(kit), past: [], future: [] }));
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
     Swap only text that is still a preset; anything written by hand stays. */
  const setLang = useCallback(
    (lang: Lang) => {
      setS(prev => {
        const pr = PRESETS[lang];
        const known = (v: string) => Object.values(PRESETS).some(p => Object.values(p).includes(v.trim()));
        const rtl = isRTL(lang);
        let headDone = false;
        const layers = prev.design.layers.map(l => {
          if (l.kind === "cta") return known(l.text) ? { ...l, text: pr.cta } : l;
          if (l.kind !== "text") return l;
          const font = rtl && l.font === "jakarta" ? "cairo" : l.font;
          if (!known(l.text)) return { ...l, font };
          if (!headDone && l.text.trim() === prev.kit.brand.trim())
            return { ...l, font, text: rtl ? pr.brand : prev.kit.brand };
          if (!headDone) {
            headDone = true;
            return { ...l, font, text: pr.head };
          }
          return { ...l, font };
        });
        const now = Date.now();
        return {
          ...prev,
          design: { ...prev.design, lang, layers },
          past: [...prev.past, { design: prev.design, tag: "lang", at: now }].slice(-HISTORY_LIMIT),
          future: [],
        };
      });
    },
    []
  );

  /* ---------- fit, per channel ---------- */
  const setFitDefault = useCallback((f: Fit) => commit("fit", d => ({ ...d, fit: f })), [commit]);
  const setFitHere = useCallback(
    (f: Fit) =>
      setS(prev =>
        prev.design.fitOverrides[prev.active] === f
          ? prev
          : {
              ...prev,
              design: { ...prev.design, fitOverrides: { ...prev.design.fitOverrides, [prev.active]: f } },
              past: [...prev.past, { design: prev.design, tag: "fitHere", at: Date.now() }].slice(-HISTORY_LIMIT),
              future: [],
            }
      ),
    []
  );
  const resetFitHere = useCallback(
    () =>
      setS(prev => {
        const fitOverrides = { ...prev.design.fitOverrides };
        delete fitOverrides[prev.active];
        return {
          ...prev,
          design: { ...prev.design, fitOverrides },
          past: [...prev.past, { design: prev.design, tag: "fitReset", at: Date.now() }].slice(-HISTORY_LIMIT),
          future: [],
        };
      }),
    []
  );
  const applyFitEverywhere = useCallback(() => {
    setS(prev => {
      const here = fitFor(prev.design, prev.active);
      return {
        ...prev,
        design: { ...prev.design, fit: here, fitOverrides: {} },
        past: [...prev.past, { design: prev.design, tag: "fitAll", at: Date.now() }].slice(-HISTORY_LIMIT),
        future: [],
      };
    });
    say("That fit is now the default everywhere");
  }, [say]);

  /* ---------- layers ---------- */
  const addLayer = useCallback(
    (kind: LayerKind | "band") => {
      let madeId = "";
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
        madeId = made.id;
        return {
          ...prev,
          selectedId: made.id,
          design: { ...prev.design, layers: [...prev.design.layers, made] },
          past: [...prev.past, { design: prev.design, tag: `add:${madeId}`, at: Date.now() }].slice(-HISTORY_LIMIT),
          future: [],
        };
      });
      say(`${kind === "band" ? "Band" : kind} layer added`);
    },
    [say]
  );

  const updateLayer = useCallback(
    (id: string, p: Partial<Layer>, tag?: string) =>
      commit(tag ?? `layer:${id}:${Object.keys(p).join(",")}`, d => ({
        ...d,
        layers: d.layers.map(l => (l.id === id ? ({ ...l, ...p } as Layer) : l)),
      })),
    [commit]
  );

  const removeLayer = useCallback(
    (id: string) =>
      commit(
        `remove:${id}`,
        d => {
          const overrides: Design["overrides"] = {};
          for (const [plId, per] of Object.entries(d.overrides)) {
            const copy = { ...per };
            delete copy[id];
            if (Object.keys(copy).length) overrides[plId] = copy;
          }
          return { ...d, layers: d.layers.filter(l => l.id !== id), overrides };
        },
        { selectedId: null }
      ),
    [commit]
  );

  const duplicateLayer = useCallback(
    (id: string) => {
      let newId = "";
      commit(`dup:${id}`, d => {
        const i = d.layers.findIndex(l => l.id === id);
        if (i === -1) return d;
        const src = d.layers[i];
        newId = `${src.kind}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
        const copy = {
          ...src,
          id: newId,
          name: `${src.name} copy`,
          pos: { x: src.pos.x + 0.03, y: src.pos.y + 0.03 },
        } as Layer;
        const layers = [...d.layers];
        layers.splice(i + 1, 0, copy);
        return { ...d, layers };
      });
      setS(prev => (newId ? { ...prev, selectedId: newId } : prev));
    },
    [commit]
  );

  const reorderLayer = useCallback(
    (id: string, dir: -1 | 1) =>
      commit(`order:${id}:${dir}`, d => {
        const layers = [...d.layers];
        const i = layers.findIndex(l => l.id === id);
        const j = i + dir;
        if (i === -1 || j < 0 || j >= layers.length) return d;
        [layers[i], layers[j]] = [layers[j], layers[i]];
        return { ...d, layers };
      }),
    [commit]
  );

  const select = useCallback((id: string | null) => setS(prev => ({ ...prev, selectedId: id })), []);

  const moveLayer = useCallback(
    (placementId: string, layerId: string, x: number, y: number) =>
      commit(`move:${placementId}:${layerId}`, d => ({
        ...d,
        overrides: { ...d.overrides, [placementId]: { ...(d.overrides[placementId] ?? {}), [layerId]: { x, y } } },
      })),
    [commit]
  );

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
        past: [...prev.past, { design: prev.design, tag: "snapThis", at: Date.now() }].slice(-HISTORY_LIMIT),
        future: [],
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
        past: [...prev.past, { design: prev.design, tag: "snapMaster", at: Date.now() }].slice(-HISTORY_LIMIT),
        future: [],
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
        past: [...prev.past, { design: prev.design, tag: "applyAll", at: Date.now() }].slice(-HISTORY_LIMIT),
        future: [],
      };
    });
    say("This position is now the default everywhere");
  }, [say]);

  const resetThis = useCallback(() => {
    setS(prev => {
      const overrides = { ...prev.design.overrides };
      delete overrides[prev.active];
      return {
        ...prev,
        design: { ...prev.design, overrides },
        past: [...prev.past, { design: prev.design, tag: "resetThis", at: Date.now() }].slice(-HISTORY_LIMIT),
        future: [],
      };
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
      past: [],
      future: [],
    }));
    say("Cleared — brand kit kept");
  }, [say]);

  const placement = useMemo(() => PLACEMENTS.find(p => p.id === s.active) ?? PLACEMENTS[0], [s.active]);
  const ctx = useMemo<LayoutContext>(
    () => ({ lang: s.design.lang, logoAspect: s.logo ? s.logo.naturalHeight / s.logo.naturalWidth : 0.3 }),
    [s.design.lang, s.logo]
  );
  const fit = fitFor(s.design, s.active);

  const value: Studio = {
    ...s,
    placement,
    ctx,
    fit,
    patch,
    patchDesign,
    loadCreative,
    loadLogo,
    clearLogo,
    setLang,
    applyKit,
    forgetKit,
    setFitDefault,
    setFitHere,
    resetFitHere,
    applyFitEverywhere,
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
    undo,
    redo,
    canUndo: s.past.length,
    canRedo: s.future.length,
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

/** Shrink an image so an upload can live in localStorage without blowing the quota. */
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
