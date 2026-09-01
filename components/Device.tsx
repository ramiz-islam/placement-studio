"use client";

/**
 * One placement rendered as the real ad frame: the creative, the platform
 * chrome, every layer in paint order, the reserved bands and the collision map.
 *
 * Dragging writes straight to the DOM node during the gesture and commits to
 * state on release — a full re-render per pointermove would recompute audits.
 */

import { useRef } from "react";
import type { Design, Placement } from "@/lib/core";
import { ICON, type Fill, type Layer, type LayerPatch } from "@/lib/layers";
import {
  clamp,
  clampPos,
  intrusion,
  placeAll,
  plateBox,
  posFor,
  rgba,
  safeF,
  type LayoutContext,
  type Placed,
} from "@/lib/geometry";
import type { Collision } from "@/lib/analysis";
import { Chrome } from "./Chrome";

const pc = (n: number) => `${(n * 100).toFixed(3)}%`;

/**
 * What an edge handle should change, per layer kind. Every layer is anchored
 * top-left, so handles grow right and down from where the layer already sits.
 */
type Dim = "blockW" | "w" | "h" | "size";
interface ResizeSpec {
  /** right edge */
  width?: Dim;
  /** bottom edge */
  height?: Dim;
  /** the corner scales width proportionally rather than freely */
  proportional?: boolean;
  /** a handle above the layer that spins it to any angle */
  rotate?: boolean;
}

function resizeSpec(l: Layer): ResizeSpec {
  switch (l.kind) {
    case "text":
      // right edge rewraps the block; bottom edge scales the type
      return { width: "blockW", height: "size" };
    case "cta":
      return { width: "size", height: "size" };
    case "icon":
      return { width: "w", proportional: true, rotate: true };
    case "logo":
      return { width: "w", proportional: true };
    case "shape":
      return l.shape === "band" ? { height: "h", rotate: false } : { width: "w", height: "h", rotate: true };
  }
}

const DIM_RANGE: Record<Dim, [number, number]> = {
  // a shape may exceed the frame — bleeding off the edge is the point
  blockW: [8, 100],
  w: [1, 220],
  h: [0.2, 220],
  size: [0.5, 30],
};


/** CSS for a solid colour or a linear gradient. */
const css = (f: Fill) =>
  f.color2
    ? `linear-gradient(${f.angle}deg, ${rgba(f.color, f.opacity)}, ${rgba(f.color2, f.opacity)})`
    : rgba(f.color, f.opacity);

export interface DeviceProps {
  pl: Placement;
  src: string;
  design: Design;
  logoSrc: string | null;
  ctx: LayoutContext;
  fit: "cover" | "contain";
  padColor: string;
  col: Collision | null;
  width: string;
  showZones: boolean;
  showFlags: boolean;
  showChrome: boolean;
  /** grid cards are not draggable */
  small?: boolean;
  /** draw the rounded phone shell; off means the exact ad frame */
  framed?: boolean;
  selectedIds?: string[];
  /** told when a repeat click stepped down to a layer underneath */
  onReachedUnder?: (layerId: string) => void;
  /** additive = ctrl/cmd or alt held, meaning add to or cycle the selection */
  onSelect?: (layerId: string, additive: boolean) => void;
  onLayerMove?: (placementId: string, layerId: string, x: number, y: number) => void;
  /** the rest of a multi-selection travels with the layer being dragged */
  onSelectionMove?: (placementId: string, dx: number, dy: number, exceptId: string) => void;
  /** live resize; commits through the same history path as everything else */
  onLayerResize?: (layerId: string, patch: LayerPatch) => void;
  /** clicking the artwork itself drops the selection */
  onDeselect?: () => void;
}

export function Device(props: DeviceProps) {
  const {
    pl,
    src,
    design: d,
    logoSrc,
    ctx,
    fit,
    padColor,
    col,
    width,
    showZones,
    showFlags,
    showChrome,
    small,
    framed,
    selectedIds,
    onReachedUnder,
    onSelect,
    onLayerMove,
    onLayerResize,
    onSelectionMove,
    onDeselect,
  } = props;

  const deviceRef = useRef<HTMLDivElement>(null);

  const f = safeF(pl);
  const cq = (px: number) => `${((px / pl.w) * 100).toFixed(3)}cqw`;
  const placed = d.copyOn ? placeAll(pl, d, ctx) : [];

  const isSelected = (id: string) => Boolean(selectedIds?.includes(id));

  /** Every layer sitting under the pointer, topmost first. */
  function stackUnder(ev: React.PointerEvent<HTMLDivElement>): string[] {
    const device = deviceRef.current;
    if (!device) return [];
    return (document.elementsFromPoint(ev.clientX, ev.clientY) as HTMLElement[])
      .filter(el => device.contains(el) && el.dataset && el.dataset.layer)
      .map(el => el.dataset.layer as string);
  }

  /**
   * Selecting and dragging, when layers are stacked.
   *
   * A click lands on the topmost layer, which made a shape behind a logo
   * unreachable — the logo took every click. The rule now:
   *
   *  - press on a layer that is already selected and it stays selected, so the
   *    press can become a drag of the thing you just reached;
   *  - release without having moved and the selection steps to the next layer
   *    down, wrapping round at the bottom;
   *  - otherwise you get the topmost layer, as expected.
   *
   * Deciding on release rather than on a double-click timer matters: a re-render
   * between two clicks can eat several hundred milliseconds, and a timing
   * window that the app's own frame rate can miss is not a rule anyone can
   * rely on.
   */
  function startDrag(clickedId: string, ev: React.PointerEvent<HTMLDivElement>) {
    const additive = ev.ctrlKey || ev.metaKey;
    // the frame deselects on pointerdown; a layer click must not reach it
    ev.stopPropagation();
    const stack = small || additive ? [] : stackUnder(ev);
    const primary = selectedIds?.length ? selectedIds[selectedIds.length - 1] : null;
    const held = primary && stack.indexOf(primary) !== -1 ? primary : null;
    const layerId = additive ? clickedId : (held ?? clickedId);
    // a click that lands on what is already selected can step deeper on release
    const cycleTo = held && stack.length > 1 ? stack[(stack.indexOf(held) + 1) % stack.length] : null;
    onSelect?.(layerId, additive);
    if (ev.altKey) {
      ev.preventDefault();
      if (cycleTo) {
        onSelect?.(cycleTo, false);
        onReachedUnder?.(cycleTo);
      }
      return;
    }
    if (small || !onLayerMove) return;
    ev.preventDefault();
    const device = deviceRef.current;
    if (!device) return;
    // the drag follows the layer we resolved to, which may sit under the pointer
    const el =
      layerId === clickedId
        ? (ev.currentTarget as HTMLElement)
        : device.querySelector<HTMLElement>(`[data-layer="${layerId}"]`) ?? (ev.currentTarget as HTMLElement);
    const rect = device.getBoundingClientRect();
    const layer = d.layers.find(l => l.id === layerId);
    if (!layer) return;
    const from = posFor(d, pl.id, layer);
    const start = { px: ev.clientX, py: ev.clientY, x: from.x, y: from.y };
    const isBand = layer.kind === "shape" && layer.shape === "band";
    // The drag may act on a layer under the pointer, so capture on the event's
    // own element and listen on the window. Capturing on the moved element
    // instead only works when it happens to be the one clicked.
    try {
      (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    } catch {
      // no active pointer to capture (synthetic events); window listeners cope
    }
    el.classList.add("grabbing");

    const read = document.createElement("div");
    read.className = "drag-readout";
    device.appendChild(read);

    const box = { w: el.offsetWidth / rect.width, h: el.offsetHeight / rect.height };
    const at = (e: PointerEvent) =>
      clampPos(box, start.x + (e.clientX - start.px) / rect.width, start.y + (e.clientY - start.py) / rect.height);

    // the other selected layers ride along, updated in the DOM during the drag
    const others =
      (selectedIds ?? []).includes(layerId) && (selectedIds ?? []).length > 1
        ? (selectedIds ?? [])
            .filter(id => id !== layerId)
            .map(id => {
              const node = device.querySelector<HTMLElement>(`[data-layer="${id}"]`);
              return node ? { id, node, left: node.offsetLeft / rect.width, top: node.offsetTop / rect.height } : null;
            })
            .filter((v): v is { id: string; node: HTMLElement; left: number; top: number } => v !== null)
        : [];

    const move = (e: PointerEvent) => {
      const { x, y } = at(e);
      el.style.top = pc(y);
      if (!isBand) el.style.left = pc(x);
      for (const o of others) {
        o.node.style.left = pc(o.left + (x - start.x));
        o.node.style.top = pc(o.top + (y - start.y));
      }
      read.style.left = pc(Math.max(0, x));
      read.style.top = pc(Math.max(0, y - 0.045));
      read.textContent = `${Math.round(x * pl.w)}, ${Math.round(y * pl.h)} px`;
      el.classList.toggle("bad-zone", !isBand && intrusion(pl, { x, y, ...box }).worst > 4);
    };
    const up = (e: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      el.classList.remove("grabbing");
      read.remove();
      const { x, y } = at(e);
      // a click that never moved is a selection, not a drag: committing it would
      // silently give this layer a per-placement override it never asked for
      const moved = Math.hypot(e.clientX - start.px, e.clientY - start.py) > 2;
      if (!moved) {
        // a press that never travelled is a click: step to the layer underneath
        if (cycleTo) {
          onSelect?.(cycleTo, false);
          onReachedUnder?.(cycleTo);
        }
        return;
      }
      if (others.length) onSelectionMove?.(pl.id, x - start.x, y - start.y, layerId);
      onLayerMove(pl.id, layerId, x, y);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }


  /**
   * Edge and corner handles. The property changes live so text rewraps and the
   * audit updates while you drag; the store coalesces the stream into one undo
   * step.
   */
  function round1(n: number) {
    return Math.round(n * 10) / 10;
  }

  function startResize(layer: Layer, edge: "e" | "s" | "se", ev: React.PointerEvent<HTMLSpanElement>) {
    if (small || !onLayerResize) return;
    ev.preventDefault();
    ev.stopPropagation();
    const device = deviceRef.current;
    if (!device) return;
    const rect = device.getBoundingClientRect();
    const spec = resizeSpec(layer);
    const host = (ev.currentTarget.parentElement as HTMLElement) ?? null;
    const startH = host ? host.offsetHeight : 1;
    const startPx = ev.clientX;
    const startPy = ev.clientY;
    const startVals: Record<string, number> = {
      blockW: layer.kind === "text" ? layer.blockW : 0,
      w: layer.kind === "shape" || layer.kind === "logo" || layer.kind === "icon" ? layer.w : 0,
      h: layer.kind === "shape" ? layer.h : 0,
      size: layer.kind === "text" || layer.kind === "cta" ? layer.size : 0,
    };
    ev.currentTarget.setPointerCapture(ev.pointerId);

    const apply = (e: PointerEvent) => {
      const dx = e.clientX - startPx;
      const dy = e.clientY - startPy;
      const patch: Record<string, number> = {};

      const wantWidth = edge === "e" || edge === "se";
      const wantHeight = edge === "s" || edge === "se";

      if (wantWidth && spec.width) {
        const dim = spec.width;
        const next =
          dim === "size"
            ? startVals.size * (1 + dx / Math.max(40, rect.width * 0.25))
            : startVals[dim] + (dx / rect.width) * 100;
        patch[dim] = round1(clamp(next, DIM_RANGE[dim][0], DIM_RANGE[dim][1]));
      }
      if (wantHeight && spec.height) {
        const dim = spec.height;
        const next =
          dim === "size"
            ? startVals.size * (1 + dy / Math.max(20, startH))
            : startVals[dim] + (dy / rect.height) * 100;
        patch[dim] = round1(clamp(next, DIM_RANGE[dim][0], DIM_RANGE[dim][1]));
      }
      if (Object.keys(patch).length) onLayerResize!(layer.id, patch as Partial<Layer>);
    };

    const move = (e: PointerEvent) => apply(e);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /**
   * Spin a layer to any angle by dragging the handle above it. Holding shift
   * snaps to 15° steps, which is how you actually get a clean 45.
   */
  function startRotate(layer: Layer, ev: React.PointerEvent<HTMLSpanElement>) {
    if (small || !onLayerResize) return;
    ev.preventDefault();
    ev.stopPropagation();
    const host = ev.currentTarget.parentElement as HTMLElement | null;
    if (!host) return;
    const r = host.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    ev.currentTarget.setPointerCapture(ev.pointerId);

    const move = (e: PointerEvent) => {
      // 0deg means the handle is straight up, so offset by a quarter turn
      let deg = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI + 90;
      if (deg > 180) deg -= 360;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      onLayerResize!(layer.id, { rotation: Math.round(deg) });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** Handles for the selected layer, sized in cqw so they hold at any preview scale. */
  function handles(l: Layer) {
    // Handles go on the layer you clicked last — the same one the inspector is
    // pointed at — so only one set is ever on screen. Gating on a single
    // selection instead meant a grouped layer could not be resized at all,
    // since selecting one member selects the whole group.
    const primary = selectedIds?.length ? selectedIds[selectedIds.length - 1] : null;
    if (small || !onLayerResize || primary !== l.id) return null;
    const spec = resizeSpec(l);
    return (
      <>
        {spec.width ? (
          <span
            className="rh rh-e"
            title={spec.proportional ? "Drag to scale" : "Drag to set width"}
            onPointerDown={e => startResize(l, "e", e)}
          />
        ) : null}
        {spec.height ? (
          <span
            className="rh rh-s"
            title={spec.height === "size" ? "Drag to scale the type" : "Drag to set height"}
            onPointerDown={e => startResize(l, "s", e)}
          />
        ) : null}
        {spec.width && spec.height ? (
          <span className="rh rh-se" title="Drag to resize" onPointerDown={e => startResize(l, "se", e)} />
        ) : null}
        {spec.rotate ? (
          <span
            className="rh rh-rot"
            title="Drag to rotate · hold Shift for 15° steps"
            onPointerDown={e => startRotate(l, e)}
          />
        ) : null}
      </>
    );
  }

  const safeW = Math.round(pl.w * (1 - f.l - f.r));
  const safeH = Math.round(pl.h * (1 - f.t - f.b));

  function renderLayer(p: Placed, i: number) {
    const l = p.layer;
    const isBand = l.kind === "shape" && l.shape === "band";
    const bad = !isBand && intrusion(pl, p.box).worst > 4;
    const cls = `lay lay-${l.kind}${bad ? " bad-zone" : ""}${isSelected(l.id) ? " selected" : ""}`;
    const base: React.CSSProperties = { left: pc(p.box.x), top: pc(p.box.y), zIndex: 6 + i };
    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => startDrag(l.id, e);

    switch (l.kind) {
      case "shape": {
        const clip = l.shape === "triangle" ? "polygon(50% 0%, 100% 100%, 0% 100%)" : undefined;
        return (
          <div
            key={l.id}
            data-layer={l.id}
            className={cls}
            onPointerDown={onPointerDown}
            style={{
              ...base,
              // the box is the rotated bounding box; render the layer's own size
              // centred inside it and rotate
              width: pc(l.shape === "band" ? 1 : l.w / 100),
              height: pc(l.h / 100),
              left: pc(p.box.x + p.box.w / 2 - (l.shape === "band" ? 1 : l.w / 100) / 2),
              top: pc(p.box.y + p.box.h / 2 - l.h / 100 / 2),
              transform: l.rotation ? `rotate(${l.rotation}deg)` : undefined,
              background: l.src ? undefined : css(l.fill),
              borderRadius: l.shape === "ellipse" ? "50%" : `${l.radius}%`,
              clipPath: l.src ? undefined : clip,
            }}
          >
            {l.src ? (
              // the clip lives on this wrapper, not the layer, so the resize
              // handles sitting outside the box are still grabbable
              <span
                style={{
                  position: "absolute",
                  inset: 0,
                  overflow: "hidden",
                  borderRadius: l.shape === "ellipse" ? "50%" : `${l.radius}%`,
                  clipPath: clip,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={l.src}
                  alt={l.name}
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              </span>
            ) : null}
            {handles(l)}
          </div>
        );
      }

      case "icon":
        return (
          <div
            key={l.id}
            data-layer={l.id}
            className={cls}
            onPointerDown={onPointerDown}
            style={{
              ...base,
              width: pc(l.w / 100),
              left: pc(p.box.x + p.box.w / 2 - l.w / 100 / 2),
              top: pc(p.box.y + p.box.h / 2 - (l.w / 100) * (pl.w / pl.h) / 2),
              transform: l.rotation ? `rotate(${l.rotation}deg)` : undefined,
            }}
          >
            {l.scrim.on ? (
              <span
                className="scrim-bg"
                aria-hidden="true"
                style={{
                  inset: `-${l.scrim.pad}%`,
                  background: css(l.scrim.fill),
                  borderRadius: `${l.scrim.radius}%`,
                }}
              />
            ) : null}
            {l.src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={l.src} alt={l.name} />
            ) : (
              <svg viewBox="0 0 24 24" style={{ display: "block", width: "100%", height: "auto", fill: l.color }}>
                <path d={ICON(l.icon).d} />
              </svg>
            )}
            {handles(l)}
          </div>
        );

      case "logo": {
        if (!logoSrc) return null;
        const platePad = (l.plate.pad / 100) * 100;
        const bandPad = (l.band.pad / 100) * 100;
        return (
          <div
            key={l.id}
            data-layer={l.id}
            className={cls}
            onPointerDown={onPointerDown}
            style={{ ...base, width: pc(p.box.w) }}
          >
            {l.band.on ? (
              <span
                className="logo-band"
                aria-hidden="true"
                style={{
                  // stretch to the full frame width regardless of the logo's box
                  left: `${(-p.box.x / p.box.w) * 100}%`,
                  width: `${(1 / p.box.w) * 100}%`,
                  top: `-${bandPad}%`,
                  bottom: `-${bandPad}%`,
                  background: css(l.band.fill),
                }}
              />
            ) : null}
            {l.plate.on ? (
              <span
                className="scrim-bg"
                aria-hidden="true"
                style={{
                  inset: `-${platePad}%`,
                  background: css(l.plate.fill),
                  borderRadius: `${l.plate.radius}%`,
                }}
              />
            ) : null}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoSrc} alt="Brand logo" />
            {handles(l)}
          </div>
        );
      }

      case "cta": {
        if (p.metrics.kind !== "cta") return null;
        const m = p.metrics;
        return (
          <div
            key={l.id}
            data-layer={l.id}
            className={cls}
            onPointerDown={onPointerDown}
            style={{
              ...base,
              background: css(l.bg),
              color: l.ink,
              fontFamily: m.fontCss,
              fontSize: cq(m.sizePx),
              padding: `${cq(m.sizePx * 0.75)} ${cq(m.sizePx * 1.1)}`,
              borderRadius: `${l.radius}%`,
            }}
          >
            {l.text}
            {handles(l)}
          </div>
        );
      }

      case "text": {
        if (p.metrics.kind !== "text") return null;
        const m = p.metrics;
        const pb = plateBox(pl, p);
        return (
          <div
            key={l.id}
            data-layer={l.id}
            className={cls}
            onPointerDown={onPointerDown}
            dir={m.rtl ? "rtl" : undefined}
            style={{
              ...base,
              width: pc(p.box.w),
              color: l.color,
              fontFamily: m.fontCss,
              fontWeight: m.weight,
              fontSize: cq(m.sizePx),
              lineHeight: m.lh,
              letterSpacing: l.tracking ? `${l.tracking}em` : undefined,
              textAlign: m.align,
              textShadow: "0 .3cqw 1.4cqw rgba(0,0,0,.28)",
            }}
          >
            {l.scrim.on ? (
              <span
                className="scrim-bg"
                aria-hidden="true"
                style={{
                  inset: `-${cq(pb.padY)} -${cq(pb.padX)}`,
                  background: css(l.scrim.fill),
                  borderRadius: cq(pb.radius),
                }}
              />
            ) : null}
            {m.lines.map((line, li) => (
              <span className="ln" key={li}>
                {line.map((t, ti) => (
                  <span key={ti} style={t.accent ? { color: l.color2 } : undefined}>
                    {t.text}
                    {ti < line.length - 1 ? " " : ""}
                  </span>
                ))}
              </span>
            ))}
            {handles(l)}
          </div>
        );
      }
    }
  }

  return (
    <div
      ref={deviceRef}
      data-placement={pl.id}
      className={`device${small ? " grid-card" : " dragmode"}${framed ? " framed" : ""}`}
      style={{ width, aspectRatio: `${pl.w}/${pl.h}` }}
      onPointerDown={() => {
        if (!small) onDeselect?.();
      }}
    >
      <div
        className={`media fit-${fit}`}
        style={fit === "contain" ? { background: padColor } : undefined}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={`Creative previewed in the ${pl.plat} ${pl.name} placement`} />
      </div>

      {showChrome ? <Chrome pl={pl} brand={chromeBrand(d)} cta={chromeCta(d)} caption={chromeCaption(d)} /> : null}

      {placed.map(renderLayer)}

      <div className={`zones${showZones ? " on" : ""}`}>
        {pl.safe.t ? <div className="band" style={{ top: 0, left: 0, right: 0, height: pc(f.t) }} /> : null}
        {pl.safe.b ? <div className="band" style={{ bottom: 0, left: 0, right: 0, height: pc(f.b) }} /> : null}
        {pl.safe.l ? (
          <div className="band" style={{ top: pc(f.t), bottom: pc(f.b), left: 0, width: pc(f.l) }} />
        ) : null}
        {pl.safe.r ? (
          <div className="band" style={{ top: pc(f.t), bottom: pc(f.b), right: 0, width: pc(f.r) }} />
        ) : null}
        <div className="safe-rect" style={{ top: pc(f.t), bottom: pc(f.b), left: pc(f.l), right: pc(f.r) }}>
          <span className="safe-tag">
            {safeW} × {safeH}
          </span>
        </div>
      </div>

      {col?.url ? (
        <div className={`flagmap${showFlags ? " on" : ""}`} style={{ backgroundImage: `url(${col.url})` }} />
      ) : null}
    </div>
  );
}

/* The chrome mocks want a brand name, a CTA label and a caption. Pull them from
   whatever layers exist rather than from fixed fields. */
function textLayers(d: Design) {
  return d.layers.filter(l => l.kind === "text" && l.on && l.text.trim());
}
function chromeBrand(d: Design): string {
  const t = textLayers(d)[0];
  return t && t.kind === "text" ? t.text.replace(/[[\]]/g, "") : "CarSwitch";
}
function chromeCaption(d: Design): string {
  const list = textLayers(d);
  const t = list[1] ?? list[0];
  return t && t.kind === "text" ? t.text.replace(/[[\]]/g, "") : "Sponsored";
}
function chromeCta(d: Design): string {
  const c = d.layers.find(l => l.kind === "cta" && l.on);
  return c && c.kind === "cta" ? c.text : "Learn more";
}
