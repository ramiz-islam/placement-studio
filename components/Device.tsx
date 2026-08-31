"use client";

/**
 * One placement rendered as a phone/feed frame: the creative, the platform
 * chrome, the draggable copy layers, the reserved bands and the collision map.
 *
 * Dragging writes straight to the DOM node during the gesture and commits to
 * state on release — a full re-render per pointermove would recompute audits.
 */

import { useRef } from "react";
import { isRTL, type Design, type LayerKey, type Placement } from "@/lib/core";
import { clamp, intrusion, layout, safeF } from "@/lib/geometry";
import type { Collision } from "@/lib/analysis";
import { Chrome } from "./Chrome";

const pc = (n: number) => `${(n * 100).toFixed(3)}%`;

export interface DeviceProps {
  pl: Placement;
  src: string;
  design: Design;
  logoSrc: string | null;
  logoAspect: number;
  fit: "cover" | "contain";
  padColor: string;
  col: Collision | null;
  width: string;
  showZones: boolean;
  showFlags: boolean;
  showChrome: boolean;
  /** grid cards are not draggable */
  small?: boolean;
  onLayerMove?: (key: LayerKey, x: number, y: number) => void;
}

export function Device(props: DeviceProps) {
  const {
    pl,
    src,
    design: d,
    logoSrc,
    logoAspect,
    fit,
    padColor,
    col,
    width,
    showZones,
    showFlags,
    showChrome,
    small,
    onLayerMove,
  } = props;

  const deviceRef = useRef<HTMLDivElement>(null);
  const f = safeF(pl);
  const L = layout(pl, d, logoAspect);
  const cq = (px: number) => `${((px / pl.w) * 100).toFixed(3)}cqw`;
  const rtl = isRTL(d.lang);

  function startDrag(key: LayerKey, ev: React.PointerEvent<HTMLDivElement>) {
    if (small || !onLayerMove) return;
    ev.preventDefault();
    const el = ev.currentTarget;
    const device = deviceRef.current;
    if (!device) return;
    const rect = device.getBoundingClientRect();
    const start = { px: ev.clientX, py: ev.clientY, x: d.layers[key].x, y: d.layers[key].y };
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
      el.style.left = pc(x);
      el.style.top = pc(y);
      read.style.left = pc(x);
      read.style.top = pc(Math.max(0, y - 0.045));
      read.textContent = `${Math.round(x * pl.w)}, ${Math.round(y * pl.h)} px`;
      const box = {
        x,
        y,
        w: el.offsetWidth / rect.width,
        h: el.offsetHeight / rect.height,
      };
      el.classList.toggle("bad-zone", intrusion(pl, box).worst > 4);
    };
    const up = (e: PointerEvent) => {
      el.releasePointerCapture(ev.pointerId);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.classList.remove("grabbing");
      read.remove();
      const { x, y } = at(e);
      onLayerMove(key, x, y);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }

  const safeW = Math.round(pl.w * (1 - f.l - f.r));
  const safeH = Math.round(pl.h * (1 - f.t - f.b));

  return (
    <div
      ref={deviceRef}
      className={`device${small ? " grid-card" : " dragmode"}`}
      style={{ width, aspectRatio: `${pl.w}/${pl.h}` }}
    >
      <div className={`media fit-${fit}`} style={fit === "contain" ? { background: padColor } : undefined}>
        {/* the creative is a data URL or a local object URL; next/image adds nothing here */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={`Creative previewed in the ${pl.plat} ${pl.name} placement`} />
      </div>

      {showChrome ? (
        <Chrome pl={pl} brand={d.brand || "CarSwitch"} cta={d.cta || "Learn more"} caption={d.head || "Sponsored"} />
      ) : null}

      {/* ---- copy layers ---- */}
      {logoSrc ? (
        <div
          className={`lay lay-logo${intrusion(pl, L.logo).worst > 4 ? " bad-zone" : ""}`}
          data-layer="logo"
          style={{ left: pc(L.logo.x), top: pc(L.logo.y), width: pc(L.logo.w) }}
          onPointerDown={e => startDrag("logo", e)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoSrc} alt="Brand logo" />
        </div>
      ) : null}

      {d.copyOn && (d.head || d.brand) ? (
        <div
          className={`lay lay-head${d.scrim ? " scrim" : ""}${intrusion(pl, L.head).worst > 4 ? " bad-zone" : ""}`}
          data-layer="head"
          dir={rtl ? "rtl" : undefined}
          style={{
            left: pc(L.head.x),
            top: pc(L.head.y),
            width: pc(L.head.w),
            color: d.headColor,
            textShadow: "0 .3cqw 1.4cqw rgba(0,0,0,.3)",
          }}
          onPointerDown={e => startDrag("head", e)}
        >
          {d.brand ? (
            <div className="lay-brand" style={{ fontSize: cq(L.head.brandPx) }}>
              {d.brand}
            </div>
          ) : null}
          {d.head ? (
            <p
              className="lay-title"
              style={{
                fontFamily: L.head.font.css,
                fontWeight: L.head.font.weight,
                fontSize: cq(L.head.headPx),
                lineHeight: L.head.lh,
              }}
            >
              {d.head}
            </p>
          ) : null}
        </div>
      ) : null}

      {d.copyOn && d.cta ? (
        <div
          className={`lay lay-cta${intrusion(pl, L.cta).worst > 4 ? " bad-zone" : ""}`}
          data-layer="cta"
          dir={rtl ? "rtl" : undefined}
          style={{
            left: pc(L.cta.x),
            top: pc(L.cta.y),
            background: d.ctaBg,
            color: d.ctaInk,
            fontSize: cq(L.cta.ctaPx),
          }}
          onPointerDown={e => startDrag("cta", e)}
        >
          {d.cta}
        </div>
      ) : null}

      {/* ---- reserved bands ---- */}
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
