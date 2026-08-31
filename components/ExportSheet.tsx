"use client";

import { useState } from "react";
import { PLACEMENTS, type Placement } from "@/lib/core";
import { dataUrlToBlob, exportName, renderPlacement } from "@/lib/render";
import { useStudio } from "./StudioProvider";
import { Field, MiniBtn, Sheet, Spinner } from "./ui";

interface Rendered {
  name: string;
  url: string;
  pl: Placement;
  w: number;
  h: number;
}

export function ExportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const st = useStudio();
  const [picked, setPicked] = useState<Set<string>>(new Set([st.active]));
  const [scale, setScale] = useState(1);
  const [type, setType] = useState("image/png");
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

  async function run() {
    if (!st.img || !picked.size) return st.say("Pick at least one placement");
    setBusy(true);
    setOut([]);
    try {
      await document.fonts.ready;
    } catch {
      /* fonts may already be resolved */
    }
    const ext = type === "image/png" ? "png" : "jpg";
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
      });
      results.push({
        name: exportName(st.design.brand || st.kit.brand, pl, canvas.width, canvas.height, ext, withGuides),
        url: canvas.toDataURL(type, 0.92),
        pl,
        w: canvas.width,
        h: canvas.height,
      });
    }
    setOut(results);
    setBusy(false);
  }

  async function save(r: Rendered) {
    // A real Next.js app can hand the file over directly — no artifact sandbox.
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
      sub="Rendered at native placement resolution, without the platform chrome."
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
            <option value={1}>Native (1×)</option>
            <option value={2}>Retina (2×)</option>
            <option value={0.5}>Half (0.5×) — quick check</option>
          </select>
        </Field>
        <Field label="Format">
          <select value={type} onChange={e => setType(e.target.value)}>
            <option value="image/png">PNG — lossless</option>
            <option value="image/jpeg">JPEG — smaller file</option>
          </select>
        </Field>
      </div>

      <div className="row">
        <MiniBtn on={withCopy} onClick={() => setWithCopy(v => !v)}>
          Include copy layers
        </MiniBtn>
        <MiniBtn on={withGuides} onClick={() => setWithGuides(v => !v)}>
          Burn in safe-zone guides
        </MiniBtn>
      </div>
      <p className="hint">
        <b>Guides</b> bake the reserved bands into the file — useful when handing a brief to a designer, never for
        upload.
      </p>

      {busy ? (
        <div className="busy">
          <Spinner /> Rendering {picked.size} {picked.size === 1 ? "image" : "images"} at native resolution…
        </div>
      ) : null}

      {out.length ? (
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
      ) : null}
    </Sheet>
  );
}
