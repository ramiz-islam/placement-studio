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
  type LayerPatch,
  type NewLayerDefaults,
} from "@/lib/layers";
import { clearAnalysisCache, samplePad } from "@/lib/analysis";
import {
  alignedPositions,
  clampPos,
  fitFor,
  masterZone,
  patchFor,
  place,
  posFor,
  safeF,
  stackInside,
  type AlignEdge,
  type LayoutContext,
} from "@/lib/geometry";

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
  /** last entry is the "primary" one the inspector edits */
  selectedIds: string[];
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
  toFront: (id: string) => void;
  toBack: (id: string) => void;
  /** the layer the inspector edits: the most recently selected */
  selectedId: string | null;
  align: (edge: AlignEdge) => void;
  /** move the selection by whole placement pixels */
  nudge: (dx: number, dy: number) => void;
  mergeSelected: () => void;
  canMerge: boolean;
  /**
   * Live resize from an edge or rotate handle. Frame gestures are local: this
   * writes a patch for the current placement and leaves the others alone.
   */
  resizeLayer: (id: string, patch: LayerPatch) => void;
  /** does this placement override anything for this layer? */
  layerPatch: (layerId: string) => LayerPatch | undefined;
  /** drop this layer's per-placement adjustments */
  resetLayerHere: (layerId: string) => void;
  select: (id: string | null, additive?: boolean) => void;
  moveLayer: (placementId: string, layerId: string, x: number, y: number) => void;
  /** apply one delta to every selected layer except the one already moved */
  moveSelected: (placementId: string, dx: number, dy: number, exceptId?: string) => void;
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
    selectedIds: [],
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

        // A shape or band is background furniture: dropping it on top would
        // cover the copy you just wrote, so it goes behind the first text or
        // button layer instead of at the front.
        const layers = [...prev.design.layers];
        const behind = made.kind === "shape";
        const at = behind ? layers.findIndex(l => l.kind === "text" || l.kind === "cta") : -1;
        if (behind && at !== -1) layers.splice(at, 0, made);
        else layers.push(made);

        return {
          ...prev,
          selectedIds: [made.id],
          design: { ...prev.design, layers },
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
        { selectedIds: [] }
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
      setS(prev => (newId ? { ...prev, selectedIds: [newId] } : prev));
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

  const toFront = useCallback(
    (id: string) =>
      commit(`front:${id}`, d => {
        const l = d.layers.find(x => x.id === id);
        if (!l) return d;
        return { ...d, layers: [...d.layers.filter(x => x.id !== id), l] };
      }),
    [commit]
  );

  const toBack = useCallback(
    (id: string) =>
      commit(`back:${id}`, d => {
        const l = d.layers.find(x => x.id === id);
        if (!l) return d;
        return { ...d, layers: [l, ...d.layers.filter(x => x.id !== id)] };
      }),
    [commit]
  );

  /**
   * One tag for the whole gesture, so a resize drag is a single undo step.
   *
   * This writes a per-placement patch rather than editing the layer, because a
   * gesture on one frame should not resize the other 22. The inspector is the
   * place to change something everywhere.
   */
  const resizeLayer = useCallback(
    (id: string, p: LayerPatch) =>
      setS(prev => {
        const plId = prev.active;
        const per = prev.design.overrides[plId] ?? {};
        const next: Design = {
          ...prev.design,
          overrides: { ...prev.design.overrides, [plId]: { ...per, [id]: { ...(per[id] ?? {}), ...p } } },
        };
        const now = Date.now();
        const last = prev.past[prev.past.length - 1];
        const tag = `resize:${plId}:${id}`;
        const coalesce = Boolean(last && last.tag === tag && now - last.at < COALESCE_MS);
        return {
          ...prev,
          design: next,
          past: coalesce
            ? prev.past.slice(0, -1).concat({ ...last!, at: now })
            : [...prev.past, { design: prev.design, tag, at: now }].slice(-HISTORY_LIMIT),
          future: [],
        };
      }),
    []
  );

  /** Drop one layer's hand-made adjustments on this placement only. */
  const resetLayerHere = useCallback((layerId: string) => {
    setS(prev => {
      const plId = prev.active;
      const per = { ...(prev.design.overrides[plId] ?? {}) };
      if (!per[layerId]) return prev;
      delete per[layerId];
      const overrides = { ...prev.design.overrides };
      if (Object.keys(per).length) overrides[plId] = per;
      else delete overrides[plId];
      return {
        ...prev,
        design: { ...prev.design, overrides },
        past: [...prev.past, { design: prev.design, tag: `resetLayer:${layerId}`, at: Date.now() }].slice(
          -HISTORY_LIMIT
        ),
        future: [],
      };
    });
    say("Back to the shared layout for this layer");
  }, [say]);

  const select = useCallback((id: string | null, additive = false) => {
    setS(prev => {
      if (id === null) return { ...prev, selectedIds: [] };
      if (!additive) return { ...prev, selectedIds: [id] };
      const has = prev.selectedIds.includes(id);
      // additive: toggle it, keeping the newest last so the inspector follows
      return {
        ...prev,
        selectedIds: has ? prev.selectedIds.filter(x => x !== id) : [...prev.selectedIds, id],
      };
    });
  }, []);

  /* ---------- alignment ---------- */
  const align = useCallback(
    (edge: AlignEdge) => {
      setS(prev => {
        const pl = PLACEMENTS.find(p => p.id === prev.active) ?? PLACEMENTS[0];
        const ctx: LayoutContext = {
          lang: prev.design.lang,
          logoAspect: prev.logo ? prev.logo.naturalHeight / prev.logo.naturalWidth : 0.3,
        };
        const ids = prev.selectedIds.length
          ? prev.selectedIds
          : prev.design.layers.filter(l => l.on).map(l => l.id);
        const placed = prev.design.layers
          .filter(l => l.on && ids.includes(l.id))
          .map(l => place(pl, prev.design, l, ctx));
        if (!placed.length) return prev;
        const next = alignedPositions(placed, edge, prev.design, pl.id);
        return {
          ...prev,
          design: {
            ...prev.design,
            overrides: {
              ...prev.design.overrides,
              [pl.id]: { ...(prev.design.overrides[pl.id] ?? {}), ...next },
            },
          },
          past: [...prev.past, { design: prev.design, tag: `align:${edge}`, at: Date.now() }].slice(-HISTORY_LIMIT),
          future: [],
        };
      });
    },
    []
  );

  /** Arrow-key nudge: the reliable way to move a layer buried under another. */
  const nudge = useCallback((dx: number, dy: number) => {
    setS(prev => {
      if (!prev.selectedIds.length) return prev;
      const pl = PLACEMENTS.find(p => p.id === prev.active) ?? PLACEMENTS[0];
      const ctx: LayoutContext = {
        lang: prev.design.lang,
        logoAspect: prev.logo ? prev.logo.naturalHeight / prev.logo.naturalWidth : 0.3,
      };
      const per = { ...(prev.design.overrides[pl.id] ?? {}) };
      for (const id of prev.selectedIds) {
        const layer = prev.design.layers.find(l => l.id === id);
        if (!layer) continue;
        const p = place(pl, prev.design, layer, ctx);
        const cur = posFor(prev.design, pl.id, layer);
        per[id] = { ...(per[id] ?? {}), pos: clampPos(p.box, cur.x + dx / pl.w, cur.y + dy / pl.h) };
      }
      const last = prev.past[prev.past.length - 1];
      const coalesce = Boolean(last && last.tag === "nudge" && Date.now() - last.at < COALESCE_MS);
      return {
        ...prev,
        design: { ...prev.design, overrides: { ...prev.design.overrides, [pl.id]: per } },
        past: coalesce
          ? prev.past.slice(0, -1).concat({ ...last!, at: Date.now() })
          : [...prev.past, { design: prev.design, tag: "nudge", at: Date.now() }].slice(-HISTORY_LIMIT),
        future: [],
      };
    });
  }, []);

  /**
   * Merge the selected text layers into one, joining their lines. Only text
   * merges: flattening a shape and a caption into a single object would throw
   * away the ability to restyle either, which is the whole point of layers.
   */
  const mergeSelected = useCallback(() => {
    setS(prev => {
      const chosen = prev.design.layers.filter(l => prev.selectedIds.includes(l.id) && l.kind === "text");
      if (chosen.length < 2) return prev;
      // keep the layer the inspector is pointed at — its styling is the one the
      // user was just looking at, so the result is what they expect
      const primaryId = prev.selectedIds[prev.selectedIds.length - 1];
      const keep = chosen.find(l => l.id === primaryId) ?? chosen[0];
      const merged = {
        ...keep,
        text: chosen.map(l => (l.kind === "text" ? l.text : "")).filter(Boolean).join(" "),
        name: keep.name,
      } as Layer;
      const drop = new Set(chosen.slice(1).map(l => l.id));
      const overrides: Design["overrides"] = {};
      for (const [plId, per] of Object.entries(prev.design.overrides)) {
        const copy = { ...per };
        for (const id of drop) delete copy[id];
        if (Object.keys(copy).length) overrides[plId] = copy;
      }
      return {
        ...prev,
        selectedIds: [keep.id],
        design: {
          ...prev.design,
          layers: prev.design.layers.filter(l => !drop.has(l.id)).map(l => (l.id === keep.id ? merged : l)),
          overrides,
        },
        past: [...prev.past, { design: prev.design, tag: "merge", at: Date.now() }].slice(-HISTORY_LIMIT),
        future: [],
      };
    });
    say("Text layers merged");
  }, [say]);

  const moveLayer = useCallback(
    (placementId: string, layerId: string, x: number, y: number) =>
      commit(`move:${placementId}:${layerId}`, d => {
        const per = d.overrides[placementId] ?? {};
        return {
          ...d,
          overrides: {
            ...d.overrides,
            [placementId]: { ...per, [layerId]: { ...(per[layerId] ?? {}), pos: { x, y } } },
          },
        };
      }),
    [commit]
  );

  /**
   * Move every selected layer by the same delta. A multi-selection behaves like
   * a group when dragged, which is what selecting several of them implies.
   */
  const moveSelected = useCallback((placementId: string, dx: number, dy: number, exceptId?: string) => {
    setS(prev => {
      const ids = prev.selectedIds.filter(id => id !== exceptId);
      if (!ids.length) return prev;
      const pl = PLACEMENTS.find(p => p.id === placementId) ?? PLACEMENTS[0];
      const ctx: LayoutContext = {
        lang: prev.design.lang,
        logoAspect: prev.logo ? prev.logo.naturalHeight / prev.logo.naturalWidth : 0.3,
      };
      const per = { ...(prev.design.overrides[placementId] ?? {}) };
      for (const id of ids) {
        const layer = prev.design.layers.find(l => l.id === id);
        if (!layer) continue;
        const p = place(pl, prev.design, layer, ctx);
        const cur = posFor(prev.design, placementId, layer);
        per[id] = { ...(per[id] ?? {}), pos: clampPos(p.box, cur.x + dx, cur.y + dy) };
      }
      return { ...prev, design: { ...prev.design, overrides: { ...prev.design.overrides, [placementId]: per } } };
    });
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
          layers: prev.design.layers.map(l => (next[l.id] ? ({ ...l, ...next[l.id] } as Layer) : l)),
          overrides: {},
        },
        past: [...prev.past, { design: prev.design, tag: "snapMaster", at: Date.now() }].slice(-HISTORY_LIMIT),
        future: [],
      };
    });
    say("Master layout applied to every placement");
  }, [say]);

  /**
   * Promote everything this placement has been adjusted by hand to the shared
   * layers, and clear every placement's overrides. What you are looking at
   * becomes the baseline for all 23.
   */
  const applyToAll = useCallback(() => {
    setS(prev => {
      const per = prev.design.overrides[prev.active] ?? {};
      return {
        ...prev,
        design: {
          ...prev.design,
          layers: prev.design.layers.map(l => (per[l.id] ? ({ ...l, ...per[l.id] } as Layer) : l)),
          overrides: {},
        },
        past: [...prev.past, { design: prev.design, tag: "applyAll", at: Date.now() }].slice(-HISTORY_LIMIT),
        future: [],
      };
    });
    say("This layout is now the baseline for every placement");
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
      selectedIds: [],
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
    toFront,
    toBack,
    resizeLayer,
    layerPatch: (layerId: string) => patchFor(s.design, s.active, layerId),
    resetLayerHere,
    select,
    selectedId: s.selectedIds.length ? s.selectedIds[s.selectedIds.length - 1] : null,
    align,
    nudge,
    mergeSelected,
    canMerge: s.design.layers.filter(l => s.selectedIds.includes(l.id) && l.kind === "text").length >= 2,
    moveLayer,
    moveSelected,
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
