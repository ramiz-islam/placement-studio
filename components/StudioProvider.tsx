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
  type KitLogo,
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
  chevronLayer,
  cutoutLayer,
  screenLayer,
  stripLayer,
  type Layer,
  type LayerPatch,
  type NewLayerDefaults,
} from "@/lib/layers";
import { clearAnalysisCache, detailMap, logoIsLight, samplePad, trimTransparent } from "@/lib/analysis";
import { autoLayout } from "@/lib/autolayout";
import {
  alignedPositions,
  clampPos,
  fitFor,
  importOverrides,
  ratioMismatch,
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
  /** the primary logo — first in the kit — kept for everything that only needs one */
  logo: HTMLImageElement | null;
  logoSrc: string | null;
  /** every kit logo, decoded and trimmed, by id */
  logoImgs: Record<string, { img: HTMLImageElement; src: string }>;
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
  cuttingOut: boolean;
  importing: boolean;
  /**
   * Checks the user has looked at and accepted, per placement:
   * ignored[placementId][check.key]. The real score is still computed and
   * shown; this only drives the second, adjusted number.
   */
  ignored: Record<string, Record<string, true>>;
}

export interface Studio extends StudioState {
  placement: Placement;
  ctx: LayoutContext;
  /** the fit this placement actually uses */
  fit: Fit;
  patch: (p: Partial<StudioState>) => void;
  patchDesign: (p: Partial<Design>, tag?: string) => void;
  loadCreative: (src: string, name: string, bytes: number, opts?: { autoPlace?: boolean }) => void;
  /** read a Photoshop file: its artwork becomes the creative, its layers become layers */
  importPsd: (file: File, opts?: { flatten?: boolean }) => Promise<void>;
  /** the same, from a Figma frame link, as the connected Figma user */
  importFigma: (url: string) => Promise<void>;
  importing: boolean;
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
  addLayer: (kind: AddKind) => void;
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
  /** true when merging would flatten text; false when it would group */
  mergeIsFlatten: boolean;
  ungroupSelected: () => void;
  canUngroup: boolean;
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
  /** put a screenshot on a screen layer and remember it for the next one */
  loadScreenshot: (layerId: string, src: string) => void;
  /* ---- multiple logos ---- */
  addKitLogo: (src: string, name: string) => void;
  renameKitLogo: (id: string, name: string) => void;
  makePrimaryLogo: (id: string) => void;
  removeKitLogo: (id: string) => void;
  /** decoded kit logos by id, for the frame */
  logoImgs: Record<string, { img: HTMLImageElement; src: string }>;
  /** the same, as sources, for the preview */
  logoSrcs: Record<string, string>;
  /** the same, as images, for the audit and export */
  logos: Record<string, HTMLImageElement>;
  /** acknowledge a check on this placement, or take the acknowledgement back */
  toggleIgnore: (key: string) => void;
  ignoredHere: Record<string, true>;
  /**
   * Cut the subject out of the creative and add it as a front layer, so a
   * shape can sit behind them.
   */
  cutOutSubject: () => Promise<void>;
  cuttingOut: boolean;
  /** place the copy and logo clear of the busiest artwork, here */
  autoPlaceHere: () => void;
  /** the same, worked out separately for every placement */
  autoPlaceEverywhere: () => void;
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

/** Everything the add row can insert, including the two brand shape presets. */
export type AddKind = "text" | "cta" | "logo" | "icon" | "shape" | "band" | "chevron" | "strip" | "screen";

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
    logoImgs: {},
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
    cuttingOut: false,
    importing: false,
    ignored: {},
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
    loadKitLogos(setS, k.logos);
  }, []);

  useEffect(() => {
    let saved: BrandKit | null = null;
    try {
      const raw = localStorage.getItem(KIT_KEY);
      if (raw) saved = migrateKit({ ...KIT_DEFAULTS, ...(JSON.parse(raw) as Partial<BrandKit>) });
    } catch {
      saved = null;
    }
    if (saved) {
      const kit = saved;
      setS(prev => ({ ...prev, kit, design: initialDesign(kit), past: [], future: [] }));
      loadKitLogos(setS, kit.logos);
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
    (src: string, name: string, bytes: number, opts?: { autoPlace?: boolean }) => {
      const autoPlace = opts?.autoPlace ?? true;
      const img = new Image();
      img.onload = () => {
        clearAnalysisCache();
        setS(prev => {
          const pad = samplePad(img);
          const ver = prev.ver + 1;
          if (!autoPlace) {
            // an import arrives with positions a designer chose; leave them be
            return {
              ...prev,
              img,
              src,
              meta: { name, bytes, w: img.naturalWidth, h: img.naturalHeight },
              padColor: pad,
              ver,
            };
          }
          // a plain upload replaces whatever was imported; the layers are ours again
          const design0: Design = { ...prev.design, importSource: null };
          // Look at the artwork before laying anything out. Dropping the copy
          // on default coordinates puts a logo across whatever happens to be in
          // the top-left corner, which on a selfie is usually a hand.
          const overrides: Design["overrides"] = { ...design0.overrides };
          const needPlate = new Set<string>();
          try {
            for (const pl of PLACEMENTS) {
              const m = detailMap(pl, img, fitFor(design0, pl.id), pad, ver);
              const { patches, plates } = autoLayout(pl, design0, safeF(pl), ctxOf(prev), m, pl.id);
              overrides[pl.id] = { ...(overrides[pl.id] ?? {}), ...patches };
              for (const id of plates) needPlate.add(id);
            }
          } catch {
            // analysis needs a canvas; without one the default stack still works
          }
          return {
            ...prev,
            img,
            src,
            meta: { name, bytes, w: img.naturalWidth, h: img.naturalHeight },
            padColor: pad,
            ver,
            design: {
              ...design0,
              autoPlaced: Object.fromEntries(PLACEMENTS.map(p => [p.id, true as const])),
              layers: plateLayers(design0.layers, [...needPlate], true),
              overrides,
            },
          };
        });
        say(
          autoPlace
            ? `Read the artwork and placed the copy across ${PLACEMENTS.length} placements`
            : `Loaded ${img.naturalWidth} × ${img.naturalHeight}`
        );
      };
      img.onerror = () => say("That file could not be read as an image");
      img.src = src;
    },
    [say]
  );

  const persistKit = (k: BrandKit) => {
    try {
      localStorage.setItem(KIT_KEY, JSON.stringify(k));
    } catch {
      /* too large to persist; still active this session */
    }
  };

  /** Replace the primary logo, or create it. Older callers only ever had one. */
  const loadLogo = useCallback((src: string, persist = true) => {
    setS(prev => {
      const logos = prev.kit.logos.length
        ? prev.kit.logos.map((l, i) => (i === 0 ? { ...l, src } : l))
        : [{ id: "primary", name: "Primary", src }];
      const k = { ...prev.kit, logo: src, logos };
      if (persist) persistKit(k);
      loadKitLogos(setS, logos);
      return { ...prev, kit: k };
    });
  }, []);

  /** Add another logo to the kit — an emblem, a mono version, a favicon. */
  const addKitLogo = useCallback(
    (src: string, name: string) => {
      setS(prev => {
        const id = `logo-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
        const logos = [...prev.kit.logos, { id, name: name.trim() || `Logo ${prev.kit.logos.length + 1}`, src }];
        const k = { ...prev.kit, logo: logos[0].src, logos };
        persistKit(k);
        loadKitLogos(setS, logos);
        return { ...prev, kit: k };
      });
      say("Logo added to the kit");
    },
    [say]
  );

  const renameKitLogo = useCallback((id: string, name: string) => {
    setS(prev => {
      const logos = prev.kit.logos.map(l => (l.id === id ? { ...l, name } : l));
      const k = { ...prev.kit, logos };
      persistKit(k);
      return { ...prev, kit: k };
    });
  }, []);

  /** Move a logo to the front. The primary is what every layer shows unless it picked another. */
  const makePrimaryLogo = useCallback((id: string) => {
    setS(prev => {
      const pick = prev.kit.logos.find(l => l.id === id);
      if (!pick) return prev;
      const logos = [pick, ...prev.kit.logos.filter(l => l.id !== id)];
      const k = { ...prev.kit, logo: pick.src, logos };
      persistKit(k);
      loadKitLogos(setS, logos);
      return { ...prev, kit: k };
    });
  }, []);

  const removeKitLogo = useCallback((id: string) => {
    setS(prev => {
      const logos = prev.kit.logos.filter(l => l.id !== id);
      const k = { ...prev.kit, logo: logos[0]?.src ?? null, logos };
      persistKit(k);
      loadKitLogos(setS, logos);
      // layers pointing at it fall back to the primary rather than going blank
      const design = {
        ...prev.design,
        layers: prev.design.layers.map(l => (l.kind === "logo" && l.logoId === id ? { ...l, logoId: null } : l)),
      };
      return { ...prev, kit: k, design };
    });
  }, []);

  const loadScreenshot = useCallback(
    (layerId: string, src: string) => {
      commit(`shot:${layerId}`, d => ({
        ...d,
        layers: d.layers.map(l => (l.id === layerId && l.kind === "screen" ? { ...l, src } : l)),
      }));
      setS(prev => {
        const k = { ...prev.kit, appScreen: src };
        try {
          localStorage.setItem(KIT_KEY, JSON.stringify(k));
        } catch {
          /* too large to persist; still active this session */
        }
        return { ...prev, kit: k };
      });
      say("Screenshot loaded — drag the green pins onto the phone's glass");
    },
    [commit, say]
  );

  /**
   * Photoshop in. The file's own artwork becomes the creative and its layers
   * become ours, in the designer's positions — so auto-place is skipped, and the
   * existing stack is replaced rather than merged, since a PSD is a complete
   * design and not an addition to one.
   */
  /**
   * What every import does once it has a result, whatever it came from: the
   * file's own artwork becomes the creative, its layers replace ours in the
   * designer's positions — so auto-place is skipped — and the studio lands on
   * the placement matching the file's ratio rather than whichever was open.
   */
  const applyImport = useCallback(
    (r: { width: number; height: number; creative: string | null; layers: Layer[]; notes: string[] }, name: string, tag: string) => {
      if (!r.creative && !r.layers.length) throw new Error("Nothing in that file could be imported.");
      setS(prev => {
        // every placement gets the design mapped through its own crop of the
        // artwork; marked as auto-placed so "copy to all channels" does not
        // treat 22 derived layouts as hand-tuned work to protect
        /*
         * A design made for one ratio cannot fill another. Cover-cropping it —
         * what the first import did — zooms into the middle third of a landscape
         * file on a story slot and looks broken, because it is. Letterbox is the
         * honest default for a mismatched placement: the whole design, small,
         * with the frame note saying why. Crop stays one click away, and the
         * layers re-map when it is chosen.
         */
        const fitOverrides = { ...prev.design.fitOverrides };
        for (const pl of PLACEMENTS) {
          if (ratioMismatch(r.width, r.height, pl)) fitOverrides[pl.id] = "contain";
          else delete fitOverrides[pl.id];
        }
        const draft: Design = { ...prev.design, fitOverrides };
        const overrides = importOverrides(r.layers, r.width, r.height, PLACEMENTS, pl => fitFor(draft, pl.id));
        return {
          ...prev,
          importing: false,
          selectedIds: [],
          design: {
            ...draft,
            layers: r.layers,
            overrides,
            importSource: { w: r.width, h: r.height },
            autoPlaced: Object.fromEntries(Object.keys(overrides).map(id => [id, true as const])),
          },
          past: [...prev.past, { design: prev.design, tag, at: Date.now() }].slice(-HISTORY_LIMIT),
          future: [],
        };
      });
      // the creative is the flattened background, not the source file; size it
      // honestly or the file-size check fails an export that will be a fraction of it
      const bytes = r.creative ? Math.round((r.creative.length - r.creative.indexOf(",") - 1) * 0.75) : 0;
      if (r.creative) loadCreative(r.creative, name, bytes, { autoPlace: false });
      const ratio = r.width / r.height;
      const best = PLACEMENTS.reduce((a, b) => (Math.abs(b.w / b.h - ratio) < Math.abs(a.w / a.h - ratio) ? b : a));
      setS(prev => ({ ...prev, active: best.id, plat: best.plat }));
      console.info(`[${tag}]`, r.notes.join(" "));
      say(r.notes[r.notes.length - 1] ?? "Imported");
    },
    [loadCreative, say]
  );

  const importPsd = useCallback(
    async (file: File, opts?: { flatten?: boolean }) => {
      setS(prev => ({ ...prev, importing: true }));
      try {
        const { importPsd: parse } = await import("@/lib/psd");
        applyImport(await parse(file, kitDefaults(s.kit), opts), file.name, opts?.flatten ? "importPsdFlat" : "importPsd");
      } catch (e) {
        setS(prev => ({ ...prev, importing: false }));
        say(e instanceof Error ? e.message : "That file could not be read as a PSD.");
      }
    },
    [s.kit, applyImport, say]
  );

  const importFigma = useCallback(
    async (url: string) => {
      setS(prev => ({ ...prev, importing: true }));
      try {
        const res = await fetch("/api/figma/import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url, defaults: kitDefaults(s.kit) }),
        });
        const json = (await res.json()) as {
          error?: string;
          width: number;
          height: number;
          creative: string | null;
          creativeColor?: string | null;
          layers: Layer[];
          notes: string[];
        };
        if (!res.ok) throw new Error(json.error || "The Figma import failed.");
        // a frame whose background is a flat colour: paint it here, where there is a canvas
        if (!json.creative && json.creativeColor) {
          const c = document.createElement("canvas");
          c.width = Math.round(json.width);
          c.height = Math.round(json.height);
          const g = c.getContext("2d")!;
          g.fillStyle = json.creativeColor;
          g.fillRect(0, 0, c.width, c.height);
          json.creative = c.toDataURL("image/png");
        }
        applyImport(json, "Figma frame", "importFigma");
      } catch (e) {
        setS(prev => ({ ...prev, importing: false }));
        say(e instanceof Error ? e.message : "The Figma import failed.");
      }
    },
    [s.kit, applyImport, say]
  );

  const toggleIgnore = useCallback((key: string) => {
    setS(prev => {
      const per = { ...(prev.ignored[prev.active] ?? {}) };
      if (per[key]) delete per[key];
      else per[key] = true;
      return { ...prev, ignored: { ...prev.ignored, [prev.active]: per } };
    });
  }, []);

  /** Remove the primary logo. With others in the kit, the next one steps up. */
  const clearLogo = useCallback(() => {
    setS(prev => {
      const logos = prev.kit.logos.slice(1);
      const k = { ...prev.kit, logo: logos[0]?.src ?? null, logos };
      persistKit(k);
      loadKitLogos(setS, logos);
      return { ...prev, kit: k };
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

  /**
   * After a fit change, imported layers have to follow the artwork through the
   * new transform, or they sit where the old crop put them while the picture
   * moves underneath. Rewrites the import patches for the given placements;
   * anything built here rather than imported is left alone.
   */
  const remapImports = (d: Design, placements: Placement[]): Design => {
    if (!d.importSource) return d;
    const fresh = importOverrides(d.layers, d.importSource.w, d.importSource.h, placements, pl => fitFor(d, pl.id));
    const overrides = { ...d.overrides };
    const autoPlaced = { ...d.autoPlaced };
    for (const pl of placements) {
      if (fresh[pl.id]) {
        overrides[pl.id] = fresh[pl.id];
        autoPlaced[pl.id] = true;
      } else {
        // the identity: the base layers already hold the source positions
        delete overrides[pl.id];
        delete autoPlaced[pl.id];
      }
    }
    return { ...d, overrides, autoPlaced };
  };

  const setFitDefault = useCallback(
    (f: Fit) => commit("fit", d => remapImports({ ...d, fit: f }, PLACEMENTS)),
    [commit]
  );
  const setFitHere = useCallback(
    (f: Fit) =>
      setS(prev =>
        prev.design.fitOverrides[prev.active] === f
          ? prev
          : {
              ...prev,
              design: remapImports(
                { ...prev.design, fitOverrides: { ...prev.design.fitOverrides, [prev.active]: f } },
                PLACEMENTS.filter(p => p.id === prev.active)
              ),
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
          design: remapImports({ ...prev.design, fitOverrides }, PLACEMENTS.filter(p => p.id === prev.active)),
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
        design: remapImports({ ...prev.design, fit: here, fitOverrides: {} }, PLACEMENTS),
        past: [...prev.past, { design: prev.design, tag: "fitAll", at: Date.now() }].slice(-HISTORY_LIMIT),
        future: [],
      };
    });
    say("That fit is now the default everywhere");
  }, [say]);

  /* ---------- layers ---------- */
  const addLayer = useCallback(
    (kind: AddKind) => {
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
                  : kind === "screen"
                    ? screenLayer({ src: prev.kit.appScreen })
                    : kind === "band"
                      ? bandLayer()
                      : kind === "chevron"
                        ? chevronLayer()
                        : kind === "strip"
                          ? stripLayer()
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
      // Mint the id before the updater runs. Reading it back out of the updater
      // afterwards left the copy unselected — the updater is called during
      // render, and twice in development — so you lost your selection, and with
      // it the floating toolbar, the moment you duplicated anything.
      const newId = `copy-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
      commit(
        `dup:${id}`,
        d => {
          const i = d.layers.findIndex(l => l.id === id);
          if (i === -1) return d;
          const src = d.layers[i];
          const copy = {
            ...src,
            id: newId,
            name: `${src.name} copy`,
            pos: { x: src.pos.x + 0.03, y: src.pos.y + 0.03 },
          } as Layer;
          const layers = [...d.layers];
          layers.splice(i + 1, 0, copy);
          return { ...d, layers };
        },
        { selectedIds: [newId] }
      );
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
          autoPlaced: handTouched(prev.design, plId),
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

  /**
   * A hand edit on a placement means its layout is no longer auto-placed. Kept
   * as one helper so every write path agrees — the confirm on "copy to all
   * channels" reads this to decide whether there is real work to warn about.
   */
  const handTouched = (d: Design, placementId: string): Record<string, true> => {
    if (!d.autoPlaced[placementId]) return d.autoPlaced;
    const next = { ...d.autoPlaced };
    delete next[placementId];
    return next;
  };

  const select = useCallback((id: string | null, additive = false) => {
    setS(prev => {
      if (id === null) return { ...prev, selectedIds: [] };
      // grouped layers are one object: touching any member takes the whole set,
      // with the clicked layer last so the inspector points at what you hit
      const g = prev.design.layers.find(l => l.id === id)?.group;
      const family = g
        ? [...prev.design.layers.filter(l => l.group === g && l.id !== id).map(l => l.id), id]
        : [id];
      if (!additive) return { ...prev, selectedIds: family };
      const has = prev.selectedIds.includes(id);
      return {
        ...prev,
        selectedIds: has
          ? prev.selectedIds.filter(x => !family.includes(x))
          : [...prev.selectedIds.filter(x => !family.includes(x)), ...family],
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
        logoAspects: aspectsOf(prev.logoImgs),
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
            autoPlaced: handTouched(prev.design, pl.id),
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
        logoAspects: aspectsOf(prev.logoImgs),
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
        design: {
          ...prev.design,
          autoPlaced: handTouched(prev.design, pl.id),
          overrides: { ...prev.design.overrides, [pl.id]: per },
        },
        past: coalesce
          ? prev.past.slice(0, -1).concat({ ...last!, at: Date.now() })
          : [...prev.past, { design: prev.design, tag: "nudge", at: Date.now() }].slice(-HISTORY_LIMIT),
        future: [],
      };
    });
  }, []);

  /**
   * Merge whatever is selected.
   *
   * Two or more text layers flatten into one, joining their lines — that is a
   * true merge, and it is what you want for a headline and a stray subheading.
   *
   * Anything else groups instead. Flattening a logo into a shape would bake one
   * into the other and lose the ability to restyle either, so the layers stay
   * separate but move as a single object: pick up any member and the rest come
   * with it. Ungroup puts them back.
   */
  const mergeSelected = useCallback(() => {
    setS(prev => {
      const picked = prev.design.layers.filter(l => prev.selectedIds.includes(l.id));
      if (picked.length < 2) return prev;

      if (!picked.every(l => l.kind === "text")) {
        const gid = `g-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
        const ids = new Set(picked.map(l => l.id));
        return {
          ...prev,
          design: {
            ...prev.design,
            layers: prev.design.layers.map(l => (ids.has(l.id) ? ({ ...l, group: gid } as Layer) : l)),
          },
          past: [...prev.past, { design: prev.design, tag: "group", at: Date.now() }].slice(-HISTORY_LIMIT),
          future: [],
        };
      }

      const chosen = picked;
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
    say("Merged");
  }, [say]);

  /** Break a group back into loose layers. */
  const ungroupSelected = useCallback(() => {
    setS(prev => {
      const groups = new Set(
        prev.design.layers.filter(l => prev.selectedIds.includes(l.id) && l.group).map(l => l.group)
      );
      if (!groups.size) return prev;
      return {
        ...prev,
        design: {
          ...prev.design,
          layers: prev.design.layers.map(l => (l.group && groups.has(l.group) ? ({ ...l, group: null } as Layer) : l)),
        },
        past: [...prev.past, { design: prev.design, tag: "ungroup", at: Date.now() }].slice(-HISTORY_LIMIT),
        future: [],
      };
    });
    say("Ungrouped");
  }, [say]);

  const moveLayer = useCallback(
    (placementId: string, layerId: string, x: number, y: number) =>
      commit(`move:${placementId}:${layerId}`, d => {
        const per = d.overrides[placementId] ?? {};
        return {
          ...d,
          autoPlaced: handTouched(d, placementId),
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
        logoAspects: aspectsOf(prev.logoImgs),
      };
      const per = { ...(prev.design.overrides[placementId] ?? {}) };
      for (const id of ids) {
        const layer = prev.design.layers.find(l => l.id === id);
        if (!layer) continue;
        const p = place(pl, prev.design, layer, ctx);
        const cur = posFor(prev.design, placementId, layer);
        per[id] = { ...(per[id] ?? {}), pos: clampPos(p.box, cur.x + dx, cur.y + dy) };
      }
      return {
        ...prev,
        design: {
          ...prev.design,
          autoPlaced: handTouched(prev.design, placementId),
          overrides: { ...prev.design.overrides, [placementId]: per },
        },
      };
    });
  }, []);

  const ctxOf = (st: StudioState): LayoutContext => ({
    lang: st.design.lang,
    logoAspect: st.logo ? st.logo.naturalHeight / st.logo.naturalWidth : 0.3,
    logoAspects: aspectsOf(st.logoImgs),
  });

  /**
   * Switch a plate on behind layers the artwork is too busy for. Position alone
   * cannot rescue a logo when every quiet spot is taken, and a soft dark plate
   * is what a designer would reach for.
   */
  const plateLayers = (layers: Layer[], ids: string[], clearRest = false): Layer[] => {
    if (!ids.length && !clearRest) return layers;
    const set = new Set(ids);
    // A washed-out grey halo three times the size of the logo is worse than no
    // plate at all. A brand block sized to the mark is what a designer draws —
    // and which brand colour depends on the logo, so measure it.
    const logoInk = logoIsLight(s.logo) ? "#141652" : "#FFFFFF";
    const brandPlate = { color: logoInk, color2: null, angle: 90, opacity: 100 };
    const textScrim = { color: "#141652", color2: null, angle: 90, opacity: 72 };
    return layers.map(l => {
      const want = set.has(l.id);
      if (!want) {
        // Only a fresh creative clears these. A scrim the last picture needed is
        // not one this picture needs, but a scrim the user switched on is theirs.
        if (!clearRest || (l.kind !== "logo" && l.kind !== "text")) return l;
        if (l.kind === "logo") return l.plate.on ? ({ ...l, plate: { ...l.plate, on: false } } as Layer) : l;
        return l.scrim.on ? ({ ...l, scrim: { ...l.scrim, on: false } } as Layer) : l;
      }
      if (l.kind === "logo") return { ...l, plate: { on: true, fill: brandPlate, pad: 9, radius: 4 } } as Layer;
      if (l.kind === "text") return { ...l, scrim: { on: true, fill: textScrim, pad: 14, radius: 4 } } as Layer;
      return l;
    });
  };

  /**
   * Ask the model for the subject on a transparent background, then drop it in
   * front of everything.
   *
   * The artwork stays put as the background. Anything you add afterwards —
   * a brand block, a strip — goes between the two, which is what makes it read
   * as being behind the person.
   */
  const cutOutSubject = useCallback(async () => {
    if (!s.src) return say("Load a creative first");
    setS(prev => ({ ...prev, cuttingOut: true }));
    try {
      const res = await fetch("/api/cutout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: s.src }),
      });
      const json = (await res.json()) as { image?: string; error?: string };
      if (!res.ok || !json.image) throw new Error(json.error || "The cut-out failed.");

      // measure it so the layer keeps the subject's proportions
      const img = new Image();
      const ratio = await new Promise<number>(resolve => {
        img.onload = () => resolve(img.naturalHeight / Math.max(1, img.naturalWidth));
        img.onerror = () => resolve(1.4);
        img.src = json.image!;
      });
      const pl = PLACEMENTS.find(x => x.id === s.active) ?? PLACEMENTS[0];
      const made = cutoutLayer(json.image, ratio * (pl.w / pl.h));

      setS(prev => ({
        ...prev,
        cuttingOut: false,
        selectedIds: [made.id],
        // in front of everything, which is the whole point
        design: { ...prev.design, layers: [...prev.design.layers, made] },
        past: [...prev.past, { design: prev.design, tag: "cutout", at: Date.now() }].slice(-HISTORY_LIMIT),
        future: [],
      }));
      say("Subject cut out — add a shape and send it behind to sit it behind them");
    } catch (e) {
      setS(prev => ({ ...prev, cuttingOut: false }));
      say(e instanceof Error ? e.message : "The cut-out failed.");
    }
  }, [s.src, s.active, say]);

  /**
   * Place the copy and the logo by looking at the artwork, not just at the
   * platform's reserved bands.
   *
   * The old "snap into the safe box" only knew where the furniture was, so it
   * would stack the logo over a face or a hand: legal, and unreadable. This
   * scores candidate positions for detail density and tonal contrast and takes
   * the quietest one that fits.
   */
  const autoPlaceHere = useCallback(() => {
    if (!s.img) return;
    const pl = PLACEMENTS.find(p => p.id === s.active) ?? PLACEMENTS[0];
    const m = detailMap(pl, s.img, fitFor(s.design, pl.id), s.padColor, s.ver);
    const { patches, plates, note } = autoLayout(pl, s.design, safeF(pl), ctxOf(s), m, pl.id);
    setS(prev => ({
      ...prev,
      design: {
        ...prev.design,
        autoPlaced: { ...prev.design.autoPlaced, [pl.id]: true },
        layers: plateLayers(prev.design.layers, plates),
        overrides: {
          ...prev.design.overrides,
          [pl.id]: { ...(prev.design.overrides[pl.id] ?? {}), ...patches },
        },
      },
      past: [...prev.past, { design: prev.design, tag: "autoPlace", at: Date.now() }].slice(-HISTORY_LIMIT),
      future: [],
    }));
    say(note);
  }, [s, say]);

  /**
   * The same, for every placement. Each one gets its own answer, because each
   * one crops the artwork differently — what is sky on a 9:16 story can be a
   * windscreen on a 16:9 pre-roll.
   */
  const autoPlaceEverywhere = useCallback(() => {
    if (!s.img) return;
    const img = s.img;
    const overrides: Design["overrides"] = { ...s.design.overrides };
    const needPlate = new Set<string>();
    for (const pl of PLACEMENTS) {
      const m = detailMap(pl, img, fitFor(s.design, pl.id), s.padColor, s.ver);
      const { patches, plates } = autoLayout(pl, s.design, safeF(pl), ctxOf(s), m, pl.id);
      overrides[pl.id] = { ...(overrides[pl.id] ?? {}), ...patches };
      for (const id of plates) needPlate.add(id);
    }
    setS(prev => ({
      ...prev,
      design: {
        ...prev.design,
        autoPlaced: Object.fromEntries(PLACEMENTS.map(p => [p.id, true as const])),
        layers: plateLayers(prev.design.layers, [...needPlate]),
        overrides,
      },
      past: [...prev.past, { design: prev.design, tag: "autoPlaceAll", at: Date.now() }].slice(-HISTORY_LIMIT),
      future: [],
    }));
    say(`Placed clear of the artwork on all ${PLACEMENTS.length} placements`);
  }, [s, say]);

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
          autoPlaced: {},
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
    () => ({
      lang: s.design.lang,
      logoAspect: s.logo ? s.logo.naturalHeight / s.logo.naturalWidth : 0.3,
      logoAspects: aspectsOf(s.logoImgs),
    }),
    [s.design.lang, s.logo, s.logoImgs]
  );
  const logoSrcs = useMemo(
    () => Object.fromEntries(Object.entries(s.logoImgs).map(([id, v]) => [id, v.src])),
    [s.logoImgs]
  );
  const logoImgsOnly = useMemo(
    () => Object.fromEntries(Object.entries(s.logoImgs).map(([id, v]) => [id, v.img])),
    [s.logoImgs]
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
    canMerge: s.selectedIds.length >= 2,
    mergeIsFlatten: s.design.layers.filter(l => s.selectedIds.includes(l.id)).every(l => l.kind === "text"),
    ungroupSelected,
    canUngroup: s.design.layers.some(l => s.selectedIds.includes(l.id) && Boolean(l.group)),
    moveLayer,
    moveSelected,
    loadScreenshot,
    importPsd,
    importFigma,
    importing: s.importing,
    addKitLogo,
    renameKitLogo,
    makePrimaryLogo,
    removeKitLogo,
    logoImgs: s.logoImgs,
    logoSrcs: logoSrcs,
    logos: logoImgsOnly,
    toggleIgnore,
    ignoredHere: s.ignored[s.active] ?? {},
    cutOutSubject,
    cuttingOut: s.cuttingOut,
    autoPlaceHere,
    autoPlaceEverywhere,
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

/** height/width for every decoded logo, keyed by kit id */
function aspectsOf(imgs: Record<string, { img: HTMLImageElement }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, v] of Object.entries(imgs)) {
    if (v.img.naturalWidth) out[id] = v.img.naturalHeight / v.img.naturalWidth;
  }
  return out;
}

/** A kit saved before there was a list still carried one logo. Lift it into the list once. */
function migrateKit(k: BrandKit): BrandKit {
  if ((!k.logos || !k.logos.length) && k.logo) {
    return { ...k, logos: [{ id: "primary", name: "Primary", src: k.logo }] };
  }
  return { ...k, logos: k.logos ?? [] };
}

/**
 * Decode every kit logo, trimmed of transparent padding, and mirror the first
 * into `logo`/`logoSrc` so the code paths that only ever needed one keep
 * working. Trimming matters: a layer's box comes from the image's aspect, so
 * padding would inflate the box and fail safe-zone checks the ink itself passes.
 */
function loadKitLogos(setS: React.Dispatch<React.SetStateAction<StudioState>>, logos: KitLogo[]) {
  if (!logos.length) {
    setS(prev => ({ ...prev, logo: null, logoSrc: null, logoImgs: {} }));
    return;
  }
  void Promise.all(
    logos.map(
      l =>
        new Promise<[string, { img: HTMLImageElement; src: string } | null]>(resolve => {
          void trimTransparent(l.src).then(trimmed => {
            const img = new Image();
            img.onload = () => resolve([l.id, { img, src: trimmed }]);
            img.onerror = () => resolve([l.id, null]);
            img.src = trimmed;
          });
        })
    )
  ).then(entries => {
    const logoImgs: Record<string, { img: HTMLImageElement; src: string }> = {};
    for (const [id, v] of entries) if (v) logoImgs[id] = v;
    const primary = logoImgs[logos[0].id] ?? null;
    setS(prev => ({
      ...prev,
      logoImgs,
      logo: primary ? primary.img : null,
      logoSrc: primary ? primary.src : null,
    }));
  });
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
