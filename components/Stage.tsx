"use client";

import { useMemo } from "react";
import { PLACEMENTS, type LayerKey } from "@/lib/core";
import { RATIO_LABEL } from "@/lib/geometry";
import { audit } from "@/lib/audit";
import { useStudio } from "./StudioProvider";
import { Device } from "./Device";

export function Stage({ onGenerate }: { onGenerate: () => void }) {
  const st = useStudio();
  const plats = useMemo(() => [...new Set(PLACEMENTS.map(p => p.plat))], []);

  const onLayerMove = (key: LayerKey, x: number, y: number) =>
    st.patchDesign({ layers: { ...st.design.layers, [key]: { x, y } } });

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

  const logoAspect = st.logo ? st.logo.naturalHeight / st.logo.naturalWidth : 0.3;
  const common = {
    src: st.src,
    design: st.design,
    logoSrc: st.logoSrc,
    logoAspect,
    fit: st.design.fit,
    padColor: st.padColor,
    showZones: st.zones,
    showFlags: st.flags,
    showChrome: st.chrome,
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

type Common = Omit<React.ComponentProps<typeof Device>, "pl" | "col" | "width">;

function FocusView({
  st,
  common,
  onLayerMove,
}: {
  st: ReturnType<typeof useStudio>;
  common: Common;
  onLayerMove: (k: LayerKey, x: number, y: number) => void;
}) {
  const pl = st.placement;
  const a = audit({
    pl,
    img: st.img!,
    meta: st.meta!,
    design: st.design,
    logo: st.logo,
    fit: st.design.fit,
    padColor: st.padColor,
    ver: st.ver,
  });
  const tall = pl.h / pl.w > 1.2;

  return (
    <div className="device-wrap">
      <Device {...common} pl={pl} col={a.col} width={tall ? "min(300px, 40vh)" : "min(440px, 90%)"} onLayerMove={onLayerMove} />
      <div className="device-cap">
        <div className="dc-name">
          {pl.plat} · {pl.name}
        </div>
        <div className="dc-spec">
          {pl.w} × {pl.h} · {RATIO_LABEL(pl.w / pl.h)} · reserved {pl.safe.t}/{pl.safe.b}/{pl.safe.l}/{pl.safe.r}
        </div>
      </div>
      <div className="snap-row">
        <button className="btn" onClick={() => st.snap(false)} type="button">
          Snap copy into this safe box
        </button>
        <button className="btn" onClick={() => st.snap(true)} type="button">
          Snap to master zone
        </button>
      </div>
      <div className="legend">
        <span>
          <i className="sw res" />
          Reserved for platform UI
        </span>
        <span>
          <i className="sw safe" />
          Safe box
        </span>
        <span>
          <i className="sw hit" />
          Busy artwork in a reserved band
        </span>
        <span>Drag the headline, CTA and logo directly on the frame</span>
      </div>
    </div>
  );
}

function GridView({ st, common }: { st: ReturnType<typeof useStudio>; common: Common }) {
  return (
    <>
      <div className="grid-head">
        <h2>Every placement, one creative</h2>
        <p>{PLACEMENTS.length} placements · scored on this exact file</p>
      </div>
      <div className="grid">
        {PLACEMENTS.map(pl => {
          const a = audit({
            pl,
            img: st.img!,
            meta: st.meta!,
            design: st.design,
            logo: st.logo,
            fit: st.design.fit,
            padColor: st.padColor,
            ver: st.ver,
          });
          const cls = a.score >= 85 ? "s-ok" : a.score >= 65 ? "s-warn" : "s-bad";
          return (
            <div key={pl.id} className={`gcard${pl.id === st.active ? " active" : ""}`}>
              <button type="button" onClick={() => st.patch({ active: pl.id, plat: pl.plat, view: "focus" })}>
                <Device {...common} pl={pl} col={a.col} width="100%" small />
                <div className="glab">
                  <div className="glab-t">
                    <div className="glab-p">{pl.plat}</div>
                    <div className="glab-n">{pl.name}</div>
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
