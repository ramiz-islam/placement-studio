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
import { ICON, type Fill } from "@/lib/layers";
import {
  clamp,
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
  selectedId?: string | null;
  onSelect?: (layerId: string) => void;
  onLayerMove?: (placementId: string, layerId: string, x: number, y: number) => void;
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
    selectedId,
    onSelect,
    onLayerMove,
  } = props;

  const deviceRef = useRef<HTMLDivElement>(null);
  const f = safeF(pl);
  const cq = (px: number) => `${((px / pl.w) * 100).toFixed(3)}cqw`;
  const placed = d.copyOn ? placeAll(pl, d, ctx) : [];

  function startDrag(layerId: string, ev: React.PointerEvent<HTMLDivElement>) {
    onSelect?.(layerId);
    if (small || !onLayerMove) return;
    ev.preventDefault();
    const el = ev.currentTarget;
    const device = deviceRef.current;
    if (!device) return;
    const rect = device.getBoundingClientRect();
    const layer = d.layers.find(l => l.id === layerId);
    if (!layer) return;
    const from = posFor(d, pl.id, layer);
    const start = { px: ev.clientX, py: ev.clientY, x: from.x, y: from.y };
    const isBand = layer.kind === "shape" && layer.shape === "band";
    el.setPointerCapture(ev.pointerId);
    el.classList.add("grabbing");

    const read = document.createElement("div");
    read.className = "drag-readout";
    device.appendChild(read);

    const at = (e: PointerEvent) => ({
      x: clamp(start.x + (e.clientX - start.px) / rect.width, -0.05, 0.98),
      y: clamp(start.y + (e.clientY - start.py) / rect.height, -0.05, 0.98),
    });

    const move = (e: PointerEvent) => {
      const { x, y } = at(e);
      el.style.top = pc(y);
      if (!isBand) el.style.left = pc(x);
      read.style.left = pc(Math.max(0, x));
      read.style.top = pc(Math.max(0, y - 0.045));
      read.textContent = `${Math.round(x * pl.w)}, ${Math.round(y * pl.h)} px`;
      el.classList.toggle(
        "bad-zone",
        !isBand &&
          intrusion(pl, { x, y, w: el.offsetWidth / rect.width, h: el.offsetHeight / rect.height }).worst > 4
      );
    };
    const up = (e: PointerEvent) => {
      el.releasePointerCapture(ev.pointerId);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.classList.remove("grabbing");
      read.remove();
      const { x, y } = at(e);
      onLayerMove(pl.id, layerId, x, y);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }

  const safeW = Math.round(pl.w * (1 - f.l - f.r));
  const safeH = Math.round(pl.h * (1 - f.t - f.b));

  function renderLayer(p: Placed, i: number) {
    const l = p.layer;
    const isBand = l.kind === "shape" && l.shape === "band";
    const bad = !isBand && intrusion(pl, p.box).worst > 4;
    const cls = `lay lay-${l.kind}${bad ? " bad-zone" : ""}${selectedId === l.id ? " selected" : ""}`;
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
              width: pc(p.box.w),
              height: pc(p.box.h),
              background: l.src ? undefined : css(l.fill),
              borderRadius: l.shape === "ellipse" ? "50%" : `${l.radius}%`,
              clipPath: clip,
              overflow: "hidden",
            }}
          >
            {l.src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={l.src}
                alt={l.name}
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
            ) : null}
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
            style={{ ...base, width: pc(p.box.w) }}
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
              textAlign: m.rtl ? "right" : "left",
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
          </div>
        );
      }
    }
  }

  return (
    <div
      ref={deviceRef}
      className={`device${small ? " grid-card" : " dragmode"}${framed ? " framed" : ""}`}
      style={{ width, aspectRatio: `${pl.w}/${pl.h}` }}
    >
      <div className={`media fit-${fit}`} style={fit === "contain" ? { background: padColor } : undefined}>
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
