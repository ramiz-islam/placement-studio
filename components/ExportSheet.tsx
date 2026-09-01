"use client";

import { useState } from "react";
import { PLACEMENTS, type Placement } from "@/lib/core";
import {
  EXT,
  dataUrlToBlob,
  encode,
  encodeUnderCap,
  exportName,
  prettyBytes,
  renderPlacement,
  upscaleFactor,
  type ExportFormat,
} from "@/lib/render";
import { useStudio } from "./StudioProvider";
import { Field, MiniBtn, Sheet, Spinner } from "./ui";

interface Rendered {
  name: string;
  url: string;
  pl: Placement;
  w: number;
  h: number;
  bytes: number;
  quality: number | null;
  format: ExportFormat;
  overCap: boolean;
  upscale: number;
}

export function ExportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const st = useStudio();
  const [picked, setPicked] = useState<Set<string>>(new Set([st.active]));
  const [scale, setScale] = useState(1);
  const [format, setFormat] = useState<ExportFormat>("image/png");
  const [quality, setQuality] = useState(95);
  const [fitCap, setFitCap] = useState(true);
  const [withCopy, setWithCopy] = useState(true);
  const [withGuides, setWithGuides] = useState(false);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<Rendered[]>([]);

  const toggle = (id: string) =>
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const bulk = (mode: "all" | "none" | "current" | "ratio") => {
    const active = st.placement;
    setPicked(
      new Set(
        PLACEMENTS.filter(p =>
          mode === "all"
            ? true
            : mode === "none"
              ? false
              : mode === "current"
                ? p.id === active.id
                : Math.abs(p.w / p.h - active.w / active.h) < 0.03
        ).map(p => p.id)
      )
    );
  };

  // worst upscale across the current selection — the honest quality ceiling
  const worstUpscale = st.img
    ? Math.max(
        1,
        ...PLACEMENTS.filter(p => picked.has(p.id)).map(p =>
          upscaleFactor(p, st.img!, st.design.fit, scale)
        )
      )
    : 1;

  async function run() {
    if (!st.img || !picked.size) return st.say("Pick at least one placement");
    setBusy(true);
    setOut([]);
    try {
      await document.fonts.ready;
    } catch {
      /* fonts may already be resolved */
    }

    const results: Rendered[] = [];
    for (const pl of PLACEMENTS.filter(p => picked.has(p.id))) {
      const canvas = renderPlacement(pl, {
        scale,
        copy: withCopy,
        guides: withGuides,
        fit: st.design.fit,
        padColor: st.padColor,
        img: st.img,
        logo: st.logo,
        design: st.design,
        ctx: st.ctx,
      });
      const cap = pl.maxMB * 1048576;
      const enc = fitCap
        ? encodeUnderCap(canvas, cap, format, st.padColor)
        : encode(canvas, format, quality / 100, st.padColor);
      results.push({
        name: exportName(st.kit.brand, pl, canvas.width, canvas.height, EXT[enc.format], withGuides),
        url: enc.url,
        pl,
        w: canvas.width,
        h: canvas.height,
        bytes: enc.bytes,
        quality: enc.quality,
        format: enc.format,
        overCap: enc.bytes > cap,
        upscale: upscaleFactor(pl, st.img, st.design.fit, scale),
      });
      // let the UI breathe between large renders
      await new Promise(r => setTimeout(r, 0));
    }
    setOut(results);
    setBusy(false);
  }

  async function save(r: Rendered) {
    const blob = await dataUrlToBlob(r.url);
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = r.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
    st.say(`Saved ${r.name}`);
  }

  async function copy(r: Rendered) {
    try {
      const blob = await dataUrlToBlob(r.url);
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      st.say("Copied — paste it straight into the ad manager");
    } catch {
      st.say("Clipboard blocked — use Save instead");
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Export statics"
      sub="Native placement resolution, sRGB, no platform chrome — upload-ready."
      foot={
        <>
          <button className="btn" onClick={onClose} type="button">
            Close
          </button>
          <button className="btn primary" onClick={run} disabled={busy} type="button">
            {busy ? "Rendering…" : `Render ${picked.size || ""}`}
          </button>
          {out.length > 1 ? (
            <button
              className="btn lime"
              type="button"
              onClick={async () => {
                for (const r of out) await save(r);
              }}
            >
              Save all
            </button>
          ) : null}
        </>
      }
    >
      <Field label="Channels and placements" hint={`${picked.size} selected`}>
        <div className="pick-grid">
          {PLACEMENTS.map(p => (
            <button
              key={p.id}
              className="pick"
              aria-pressed={picked.has(p.id)}
              onClick={() => toggle(p.id)}
              type="button"
            >
              {p.plat} · {p.name}
            </button>
          ))}
        </div>
        <div className="link-row">
          <button className="link-btn" onClick={() => bulk("all")} type="button">
            Select all
          </button>
          <button className="link-btn" onClick={() => bulk("none")} type="button">
            Clear
          </button>
          <button className="link-btn" onClick={() => bulk("current")} type="button">
            This placement only
          </button>
          <button className="link-btn" onClick={() => bulk("ratio")} type="button">
            Same ratio group
          </button>
        </div>
      </Field>

      <div className="kit-grid">
        <Field label="Resolution">
          <select value={scale} onChange={e => setScale(parseFloat(e.target.value))}>
            <option value={1}>Native (1×) — what the platform wants</option>
            <option value={2}>2× — retina / future-proofing</option>
            <option value={3}>3×</option>
            <option value={0.5}>Half (0.5×) — quick check</option>
          </select>
        </Field>
        <Field label="Format">
          <select value={format} onChange={e => setFormat(e.target.value as ExportFormat)}>
            <option value="image/png">PNG — lossless, largest</option>
            <option value="image/jpeg">JPEG — every platform accepts it</option>
            <option value="image/webp">WebP — smallest at equal quality</option>
          </select>
        </Field>
      </div>

      <div className="row">
        <MiniBtn on={fitCap} onClick={() => setFitCap(v => !v)}>
          Fit under platform limit
        </MiniBtn>
        <MiniBtn on={withCopy} onClick={() => setWithCopy(v => !v)}>
          Include copy layers
        </MiniBtn>
        <MiniBtn on={withGuides} onClick={() => setWithGuides(v => !v)}>
          Burn in guides
        </MiniBtn>
      </div>

      {fitCap ? (
        <p className="hint">
          Quality is searched per placement to land just under each one&apos;s file-size cap — Snapchat and Google
          allow 5 MB, Meta 30 MB. A PNG that already fits is kept lossless.
        </p>
      ) : (
        <Field label="Quality" hint={`${quality}%`}>
          <input
            type="range"
            min={40}
            max={100}
            step={1}
            value={quality}
            onChange={e => setQuality(Number(e.target.value))}
            disabled={format === "image/png"}
          />
          <p className="hint">
            {format === "image/png"
              ? "PNG is lossless — quality does not apply."
              : "Below about 80% you will see banding in flat brand colour."}
          </p>
        </Field>
      )}

      {worstUpscale > 1.15 ? (
        <div className="warnbox">
          <b>The source has to stretch {worstUpscale.toFixed(2)}× to fill the largest selected placement.</b> Copy and
          logo are drawn at full output resolution and stay sharp, but the photograph will soften. Generate at a
          bigger target shape, or drop to 1×, if this is going out as a paid ad.
        </div>
      ) : null}

      {withGuides ? (
        <p className="hint">
          <b>Guides</b> bake the reserved bands into the file — for briefing a designer, never for upload.
        </p>
      ) : null}

      {busy ? (
        <div className="busy">
          <Spinner /> Rendering {picked.size} {picked.size === 1 ? "image" : "images"} at{" "}
          {scale === 1 ? "native" : `${scale}×`} resolution…
        </div>
      ) : null}

      {out.length ? (
        <>
          <div className="export-grid">
            {out.map(r => (
              <div className="ex-card" key={r.pl.id}>
                <div className="thumb">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.url} alt={`${r.pl.plat} ${r.pl.name}`} />
                </div>
                <div>
                  <div className="glab-p">{r.pl.plat}</div>
                  <div className="glab-n">{r.pl.name}</div>
                </div>
                <div className="ex-meta">
                  <span>
                    {r.w} × {r.h}
                  </span>
                  <span className={r.overCap ? "over" : "ok"}>{prettyBytes(r.bytes)}</span>
                  <span>
                    {EXT[r.format].toUpperCase()}
                    {r.quality != null ? ` q${Math.round(r.quality * 100)}` : " lossless"}
                  </span>
                </div>
                {r.overCap ? (
                  <div className="ex-flag">Over the {r.pl.maxMB} MB cap — switch to JPEG or WebP.</div>
                ) : null}
                <div className="ex-name">{r.name}</div>
                <div className="row">
                  <button className="btn primary" onClick={() => save(r)} type="button">
                    Save
                  </button>
                  <button className="btn" onClick={() => copy(r)} type="button">
                    Copy
                  </button>
                </div>
              </div>
            ))}
          </div>
          <p className="hint">
            All files are 8-bit sRGB, which is what every ad platform re-encodes to. There is no HDR ad format to
            target — quality here comes from exact pixel dimensions, no upscaling, and landing under the cap without
            crushing the encode.
          </p>
        </>
      ) : null}
    </Sheet>
  );
}
