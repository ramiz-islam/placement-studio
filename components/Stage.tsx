"use client";

import { useEffect, useMemo, useState } from "react";
import { PLACEMENTS } from "@/lib/core";
import { RATIO_LABEL, fitFor, hasFitOverride, hasOverride } from "@/lib/geometry";
import { audit } from "@/lib/audit";
import { useStudio } from "./StudioProvider";
import { Device } from "./Device";
import { CanvasToolbar } from "./CanvasToolbar";

export function Stage({ onGenerate }: { onGenerate: () => void }) {
  const st = useStudio();
  const plats = useMemo(() => [...new Set(PLACEMENTS.map(p => p.plat))], []);

  // a drag writes only the placement it happened on
  const onLayerMove = (placementId: string, layerId: string, x: number, y: number) =>
    st.moveLayer(placementId, layerId, x, y);

  if (!st.img || !st.src || !st.meta) {
    return (
      <section className="stage">
        <div className="stage-body">
          <div className="stage-empty">
            <h1>
              One creative. <em>Every feed&apos;s furniture</em> in the way.
            </h1>
            <p>
              Load a creative — or generate one from a prompt — and see it sitting in each platform&apos;s real chrome,
              with the reserved bands drawn on top and the busy parts of your artwork flagged where they collide. Then
              drag your headline, CTA and logo until every placement clears.
            </p>
            <div className="sample-row">
              <button className="btn lime" onClick={onGenerate} type="button">
                Generate a creative
              </button>
              <button className="btn" onClick={() => sample("story", st.loadCreative)} type="button">
                Try a 9:16 sample
              </button>
              <button className="btn" onClick={() => sample("square", st.loadCreative)} type="button">
                Try a 1:1 sample
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const common = {
    src: st.src,
    design: st.design,
    logoSrc: st.logoSrc,
    logoSrcs: st.logoSrcs,
    ctx: st.ctx,
    padColor: st.padColor,
    showZones: st.zones,
    showFlags: st.flags,
    showChrome: st.chrome,
    framed: st.deviceFrame,
    selectedIds: st.selectedIds,
    onSelect: st.select,
    onDeselect: () => st.select(null),
    onReachedUnder: (id: string) => {
      const l = st.design.layers.find(x => x.id === id);
      if (l) st.say(`${l.name} — the layer underneath. Click again for the next one down.`);
    },
  };

  return (
    <section className="stage">
      <div className="chip-rail">
        <div className="chips">
          {plats.map(p => (
            <button
              key={p}
              className="chip"
              aria-pressed={p === st.plat}
              type="button"
              onClick={() => {
                const first = PLACEMENTS.find(x => x.plat === p);
                st.patch({ plat: p, active: first ? first.id : st.active });
              }}
            >
              {p}
            </button>
          ))}
        </div>
        <div className="chips sub">
          {PLACEMENTS.filter(p => p.plat === st.plat).map(p => (
            <button
              key={p.id}
              className="chip"
              aria-pressed={p.id === st.active}
              type="button"
              onClick={() => st.patch({ active: p.id })}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <div className="stage-body">
        {st.view === "focus" ? (
          <FocusView {...{ st, common, onLayerMove }} />
        ) : (
          <GridView {...{ st, common }} />
        )}
      </div>
    </section>
  );
}

type Common = Omit<React.ComponentProps<typeof Device>, "pl" | "col" | "width" | "fit">;

function FocusView({
  st,
  common,
  onLayerMove,
}: {
  st: ReturnType<typeof useStudio>;
  common: Common;
  onLayerMove: (placementId: string, layerId: string, x: number, y: number) => void;
}) {
  const pl = st.placement;
  const a = audit({
    pl,
    img: st.img!,
    meta: st.meta!,
    design: st.design,
    logo: st.logo,
    logos: st.logos,
    fit: st.design.fit,
    padColor: st.padColor,
    ver: st.ver,
  });
  const tall = pl.h / pl.w > 1.2;
  const custom = hasOverride(st.design, pl.id);
  const localCount = Object.keys(st.design.overrides[pl.id] ?? {}).length;
  // how much hand-tuning on other placements a "use everywhere" would destroy
  // Only hand-made layouts are worth warning about. Auto-place writes overrides
  // for all 23 on every load, so counting those made the confirm fire every
  // single time and one click looked like a dead button.
  const otherCustom = Object.entries(st.design.overrides).filter(
    ([id, per]) => id !== pl.id && Object.keys(per).length > 0 && !st.design.autoPlaced[id]
  ).length;
  const [armed, setArmed] = useState(false);
  // never leave the confirmation armed when the user has moved on
  useEffect(() => setArmed(false), [pl.id, otherCustom]);

  return (
    <div className="device-wrap">
      <CanvasToolbar />
      <Device
        {...common}
        pl={pl}
        fit={st.fit}
        col={a.col}
        width={tall ? "min(300px, 40vh)" : "min(440px, 90%)"}
        onLayerMove={onLayerMove}
        onSelectionMove={st.moveSelected}
        onLayerResize={st.resizeLayer}
      />

      {/* Six arrow glyphs meant nothing to anyone. Words, grouped by axis,
          and the note says what the click will act on before you make it. */}
      <div className="align-bar">
        <b>Align</b>
        <span className="align-set">
          {(
            [
              ["left", "Left"],
              ["hcenter", "Centre"],
              ["right", "Right"],
            ] as const
          ).map(([edge, label]) => (
            <button key={edge} className="mini-btn" onClick={() => st.align(edge)} type="button">
              {label}
            </button>
          ))}
        </span>
        <span className="align-set">
          {(
            [
              ["top", "Top"],
              ["vcenter", "Middle"],
              ["bottom", "Bottom"],
            ] as const
          ).map(([edge, label]) => (
            <button key={edge} className="mini-btn" onClick={() => st.align(edge)} type="button">
              {label}
            </button>
          ))}
        </span>
        <span className="align-note">
          {st.selectedIds.length === 0
            ? "nothing selected — aligns every layer to the frame"
            : st.selectedIds.length === 1
              ? "aligns the selected layer to the frame"
              : `aligns ${st.selectedIds.length} selected layers to each other`}
        </span>
      </div>
      <div className="device-cap">
        <div className="dc-name">
          {pl.plat} · {pl.name}
        </div>
        <div className="dc-spec">
          {pl.w} × {pl.h} · {RATIO_LABEL(pl.w / pl.h)} · reserved {pl.safe.t}/{pl.safe.b}/{pl.safe.l}/{pl.safe.r}
        </div>
      </div>
      <div className="snap-row">
        <span className="fit-group">
          <b>Fit</b>
          <button
            className="mini-btn"
            aria-pressed={st.fit === "cover"}
            onClick={() => st.setFitHere("cover")}
            type="button"
          >
            Crop
          </button>
          <button
            className="mini-btn"
            aria-pressed={st.fit === "contain"}
            onClick={() => st.setFitHere("contain")}
            type="button"
          >
            Letterbox
          </button>
          {hasFitOverride(st.design, pl.id) ? (
            <>
              <button className="link-btn" onClick={st.resetFitHere} type="button">
                use default
              </button>
              <button className="link-btn" onClick={st.applyFitEverywhere} type="button">
                make default
              </button>
            </>
          ) : null}
        </span>
      </div>

      <div className="snap-row">
        {/* The one button worth reaching for first: it reads the artwork and
            puts the copy and logo somewhere legible. */}
        <button
          className="btn lime"
          onClick={st.autoPlaceHere}
          title="Reads the artwork and moves the copy and logo to the quietest area inside the safe box"
          type="button"
        >
          Auto-place
        </button>

        {/* This is the one control here that changes other channels, and it
            throws away whatever they had been adjusted to. It used to say
            "Apply this position everywhere" and do that silently, which reads
            like a save button. Now it names the cost and asks first. */}
        <button
          className={`btn${armed ? " warn" : ""}`}
          onClick={() => {
            if (otherCustom > 0 && !armed) return setArmed(true);
            setArmed(false);
            st.applyToAll();
          }}
          title={
            otherCustom > 0
              ? `${otherCustom} other placements have their own adjustments; this replaces them`
              : "Make this layout the starting point for all 23 placements"
          }
          type="button"
        >
          {armed
            ? `Discard adjustments on ${otherCustom} other ${otherCustom === 1 ? "channel" : "channels"}?`
            : "Copy this layout to all channels"}
        </button>
        {armed ? (
          <button className="btn" onClick={() => setArmed(false)} type="button">
            Cancel
          </button>
        ) : null}

        <button
          className="btn"
          onClick={st.autoPlaceEverywhere}
          title="Works each placement out separately — the same artwork crops differently on each one"
          type="button"
        >
          Auto-place every channel
        </button>
        {custom ? (
          <button className="btn" onClick={st.resetThis} type="button">
            Reset this placement
          </button>
        ) : null}
      </div>
      <p className="pos-note">
        <b>Size, position and angle are per channel. Text, colour and font apply to all of them.</b>{" "}
        {localCount > 0 ? (
          <>
            <b style={{ color: "var(--blue-bright)" }}>
              {localCount} {localCount === 1 ? "layer is" : "layers are"} adjusted just for {pl.plat} {pl.name}
            </b>
            {" — look for the dot in the layer list. "}
          </>
        ) : null}
        {hasFitOverride(st.design, pl.id) ? (
          <>
            <b style={{ color: "var(--blue-bright)" }}>
              {st.fit === "cover" ? "Cropped" : "Letterboxed"} just for this placement
            </b>{" "}
            — every other channel uses {st.design.fit === "cover" ? "crop" : "letterbox"}.{" "}
          </>
        ) : null}
        {custom ? (
          <>
            <b style={{ color: "var(--blue-bright)" }}>Custom position</b> for {pl.plat} {pl.name} — other placements
            are untouched.
          </>
        ) : (
          <>Using the shared default position. Dragging here makes it custom to this placement only.</>
        )}
      </p>
      <div className="legend">
        <span>
          <i className="sw res" />
          Reserved for platform UI
        </span>
        <span>{st.design.layers.filter(l => l.on).length} layers</span>
        <span>
          <i className="sw safe" />
          Safe box
        </span>
        <span>
          <i className="sw hit" />
          Busy artwork in a reserved band
        </span>
        <span>
          Drag to move · edge handles to resize · <b>click again</b> on stacked layers to reach the one underneath ·{" "}
          <b>ctrl-click</b> to select several · layers snap to the safe box and to each other, <b>shift</b> to override ·
          arrow keys to nudge · click any empty part of the frame to deselect
        </span>
      </div>
    </div>
  );
}

function GridView({ st, common }: { st: ReturnType<typeof useStudio>; common: Common }) {
  return (
    <>
      <div className="grid-head">
        <h2>Every placement, one creative</h2>
        <p>
          {PLACEMENTS.length} placements · exact frames, exact chrome
        </p>
      </div>
      <div className="grid">
        {PLACEMENTS.map(pl => {
          const a = audit({
            pl,
            img: st.img!,
            meta: st.meta!,
            design: st.design,
            logo: st.logo,
            logos: st.logos,
            fit: fitFor(st.design, pl.id),
            padColor: st.padColor,
            ver: st.ver,
          });
          const cls = a.score >= 85 ? "s-ok" : a.score >= 65 ? "s-warn" : "s-bad";
          return (
            <div key={pl.id} className={`gcard${pl.id === st.active ? " active" : ""}`}>
              <button type="button" onClick={() => st.patch({ active: pl.id, plat: pl.plat, view: "focus" })}>
                <Device {...common} pl={pl} fit={fitFor(st.design, pl.id)} col={a.col} width="100%" small />
                <div className="glab">
                  <div className="glab-t">
                    <div className="glab-p">{pl.plat}</div>
                    <div className="glab-n">{pl.name}</div>
                    <div className="glab-d">
                      {pl.w} × {pl.h}
                    </div>
                  </div>
                  <span className={`score-pill ${cls}`}>{a.score}</span>
                </div>
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ------------------------------------------------------------
   Synthetic samples — built with copy near the edges so the
   collision map has something honest to find.
   ------------------------------------------------------------ */
export function sample(kind: "story" | "square", load: (src: string, name: string, bytes: number) => void) {
  const vert = kind === "story";
  const w = 1080;
  const h = vert ? 1920 : 1080;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;

  const grad = g.createLinearGradient(0, 0, w * 0.35, h);
  grad.addColorStop(0, "#0A0B1A");
  grad.addColorStop(0.5, "#141652");
  grad.addColorStop(1, "#0038A7");
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);

  g.save();
  g.translate(w * 0.5, h * (vert ? 0.44 : 0.46));
  const rg = g.createRadialGradient(0, 0, 10, 0, 0, w * 0.44);
  rg.addColorStop(0, "rgba(74,133,255,.55)");
  rg.addColorStop(1, "rgba(74,133,255,0)");
  g.fillStyle = rg;
  g.beginPath();
  g.arc(0, 0, w * 0.44, 0, Math.PI * 2);
  g.fill();

  g.fillStyle = "#E8ECFB";
  g.beginPath();
  g.moveTo(-w * 0.3, w * 0.05);
  g.quadraticCurveTo(-w * 0.24, -w * 0.03, -w * 0.1, -w * 0.05);
  g.quadraticCurveTo(w * 0.02, -w * 0.12, w * 0.16, -w * 0.04);
  g.quadraticCurveTo(w * 0.28, -w * 0.02, w * 0.3, w * 0.05);
  g.lineTo(-w * 0.3, w * 0.05);
  g.closePath();
  g.fill();
  g.fillStyle = "#0A0B1A";
  for (const [x, y] of [
    [-w * 0.18, w * 0.06],
    [w * 0.18, w * 0.06],
  ]) {
    g.beginPath();
    g.arc(x, y, w * 0.055, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = "#FF5450";
  g.fillRect(w * 0.22, -w * 0.005, w * 0.08, w * 0.02);
  g.restore();

  g.textAlign = "center";
  g.fillStyle = "#BFFF00";
  g.font = `800 ${Math.round(w * 0.082)}px 'Plus Jakarta Sans', sans-serif`;
  g.fillText("FREE INSPECTION", w / 2, h * (vert ? 0.875 : 0.895));
  g.fillStyle = "#FFFFFF";
  g.font = `600 ${Math.round(w * 0.034)}px 'Plus Jakarta Sans', sans-serif`;
  g.fillText("we handle the paperwork, you keep the price", w / 2, h * (vert ? 0.925 : 0.95));
  g.textAlign = "left";
  g.font = `800 ${Math.round(w * 0.04)}px 'Plus Jakarta Sans', sans-serif`;
  g.fillText("CarSwitch", w * 0.06, h * (vert ? 0.05 : 0.07));

  const url = c.toDataURL("image/jpeg", 0.9);
  load(url, vert ? "sample-9x16-1080x1920.jpg" : "sample-1x1-1080x1080.jpg", Math.round(url.length * 0.75));
}
