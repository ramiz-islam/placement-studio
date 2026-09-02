"use client";

/**
 * The controls you reach for constantly, floating next to whatever is selected
 * on the frame.
 *
 * The rail on the left can do far more, but reaching it means leaving the thing
 * you are looking at, scrolling to the right fold and finding the right slider.
 * These six or seven buttons cover almost every adjustment in practice — bigger,
 * smaller, that colour, centre it, tuck it behind, drop it — so the common path
 * never leaves the canvas.
 *
 * Everything here that changes geometry goes through resizeLayer, so it stays on
 * this placement, same as dragging. Colour goes through updateLayer, so it
 * applies everywhere. That is the same split the rail uses.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { resolveLayer } from "@/lib/geometry";
import type { CtaLayer, IconLayer, Layer, LogoLayer, ShapeLayer, TextLayer } from "@/lib/layers";
import { useStudio } from "./StudioProvider";

/** The layer's own size field, and a sane step, per kind. */
function sizeOf(l: Layer): { key: "size" | "w"; value: number; min: number; max: number } | null {
  switch (l.kind) {
    case "text":
    case "cta":
      return { key: "size", value: (l as TextLayer | CtaLayer).size, min: 1.5, max: 30 };
    case "logo":
      return { key: "w", value: (l as LogoLayer).w, min: 4, max: 80 };
    case "icon":
      return { key: "w", value: (l as IconLayer).w, min: 3, max: 60 };
    case "shape":
      return { key: "w", value: (l as ShapeLayer).w, min: 3, max: 100 };
    default:
      return null;
  }
}

/** The one colour a user means when they say "make it green". */
function inkOf(l: Layer): { value: string; set: (hex: string) => Partial<Layer> } | null {
  switch (l.kind) {
    case "text":
      return { value: (l as TextLayer).color, set: hex => ({ color: hex }) as Partial<Layer> };
    case "icon":
      return { value: (l as IconLayer).color, set: hex => ({ color: hex }) as Partial<Layer> };
    case "cta": {
      const c = l as CtaLayer;
      return { value: c.bg.color, set: hex => ({ bg: { ...c.bg, color: hex } }) as Partial<Layer> };
    }
    case "shape": {
      const s = l as ShapeLayer;
      return { value: s.fill.color, set: hex => ({ fill: { ...s.fill, color: hex } }) as Partial<Layer> };
    }
    default:
      return null;
  }
}

export function CanvasToolbar() {
  const st = useStudio();
  const id = st.selectedId;
  const raw = st.design.layers.find(l => l.id === id) ?? null;
  const [box, setBox] = useState<{ top: number; left: number; below: boolean } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  /**
   * Measure the selected layer where it actually landed. Reading the DOM beats
   * recomputing the layout: the frame scales with the viewport, and text height
   * depends on wrapping we do not model here.
   */
  const measure = useCallback(() => {
    if (!id) return setBox(null);
    const el = document.querySelector<HTMLElement>(`.dragmode [data-layer="${id}"]`);
    const wrap = document.querySelector<HTMLElement>(".device-wrap");
    if (!el || !wrap) return setBox(null);
    const r = el.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    const barW = barRef.current?.offsetWidth ?? 250;
    const barH = barRef.current?.offsetHeight ?? 34;
    // above the layer by default; flip below when it would leave the wrapper
    const wantTop = r.top - w.top - barH - 8;
    const below = wantTop < 0;
    return setBox({
      top: below ? r.bottom - w.top + 8 : wantTop,
      left: Math.max(4, Math.min(w.width - barW - 4, r.left - w.left + r.width / 2 - barW / 2)),
      below,
    });
  }, [id]);

  // re-measure whenever the layout could have moved under us
  useLayoutEffect(measure, [measure, st.design, st.active, st.ver, st.deviceFrame, st.chrome]);

  useEffect(() => {
    if (!id) return;
    const on = () => measure();
    window.addEventListener("resize", on);
    // a drag ends on pointerup, by which time the layer has settled
    window.addEventListener("pointerup", on);
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("pointerup", on);
    };
  }, [id, measure]);

  if (!raw || !id || !box) return null;

  const l = resolveLayer(st.design, st.active, raw);
  const size = sizeOf(l);
  const ink = inkOf(l);
  const isBand = l.kind === "shape" && (l as ShapeLayer).shape === "band";
  const canAlign = l.kind === "text" || l.kind === "cta";
  // anything but a band, which spans the frame by definition
  const canRotate = !isBand;

  // multiply rather than add, so + and - are exact inverses and one tap reads
  // the same whether the layer is tiny or huge
  const bump = (dir: 1 | -1) => {
    if (!size) return;
    const raw = dir === 1 ? size.value * 1.12 : size.value / 1.12;
    const next = Math.min(size.max, Math.max(size.min, raw));
    st.resizeLayer(id, { [size.key]: Math.round(next * 10) / 10 });
  };

  return (
    <div
      ref={barRef}
      className={`canvas-bar${box.below ? " below" : ""}`}
      style={{ top: box.top, left: box.left }}
      // clicks in here must not reach the frame's deselect handler
      onPointerDown={e => e.stopPropagation()}
    >
      <span className="cb-name">{l.name}</span>

      {size ? (
        <>
          <button className="cb" title="Smaller" data-label="Smaller" onClick={() => bump(-1)} type="button">
            −
          </button>
          <button className="cb" title="Bigger" data-label="Bigger" onClick={() => bump(1)} type="button">
            +
          </button>
        </>
      ) : null}

      {size ? <span className="cb-sep" aria-hidden="true" /> : null}
      {ink ? (
        <label className="cb cb-ink" title="Colour">
          <span style={{ background: ink.value }} />
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(ink.value) ? ink.value : "#ffffff"}
            onChange={e => st.updateLayer(id, ink.set(e.target.value))}
          />
        </label>
      ) : null}

      {canAlign ? (
        <>
          <button className="cb" title="Align left" data-label="Align left" onClick={() => st.align("left")} type="button">
            ⇤
          </button>
          <button className="cb" title="Centre" data-label="Centre" onClick={() => st.align("hcenter")} type="button">
            ↔
          </button>
          <button className="cb" title="Align right" data-label="Align right" onClick={() => st.align("right")} type="button">
            ⇥
          </button>
        </>
      ) : null}

      {canRotate ? (
        <button
          className="cb"
          title="Turn 45° · drag the green handle for any angle"
          onClick={() => {
            const cur = l.rotation ?? 0;
            let next = Math.round(cur / 45) * 45 + 45;
            if (next > 180) next -= 360;
            st.resizeLayer(id, { rotation: next });
          }}
          type="button"
        >
          ⟳
        </button>
      ) : null}

      <span className="cb-sep" aria-hidden="true" />
      <button className="cb" title="Send behind" data-label="Send behind" onClick={() => st.toBack(id)} type="button">
        ⤓
      </button>
      <button className="cb" title="Duplicate" data-label="Duplicate" onClick={() => st.duplicateLayer(id)} type="button">
        ⧉
      </button>
      <button className="cb danger" title="Delete" data-label="Delete" onClick={() => st.removeLayer(id)} type="button">
        ✕
      </button>
    </div>
  );
}
