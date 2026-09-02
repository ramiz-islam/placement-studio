"use client";

import { useRef } from "react";
import { PRESETS, type Lang } from "@/lib/core";
import { RATIO_LABEL } from "@/lib/geometry";
import { LAYOUTS } from "@/lib/layers";
import { useStudio } from "./StudioProvider";
import { Field, MiniBtn } from "./ui";
import { LayersPanel } from "./LayersPanel";
import { sample } from "./Stage";

export function LeftRail({ onGenerate }: { onGenerate: () => void }) {
  const st = useStudio();
  const fileRef = useRef<HTMLInputElement>(null);
  const d = st.design;

  const readCreative = (f: File | undefined) => {
    if (!f || !f.type.startsWith("image/")) return st.say("Images only for now");
    const fr = new FileReader();
    fr.onload = e => st.loadCreative(String(e.target?.result), f.name, f.size);
    fr.readAsDataURL(f);
  };

  return (
    <aside className="col col-left">
      {/* ---------- creative ---------- */}
      <div className="panel">
        <div className="p-head">
          <span className="p-title">Creative</span>
          <span className="p-note">{st.meta ? `${RATIO_LABEL(st.meta.w / st.meta.h)} source` : ""}</span>
        </div>

        {st.meta && st.src ? (
          <div className="creative">
            <div className="creative-thumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={st.src} alt="" />
            </div>
            <div className="creative-meta">
              <div className="creative-name">{st.meta.name}</div>
              <div className="creative-dims">
                {st.meta.w} × {st.meta.h} · {RATIO_LABEL(st.meta.w / st.meta.h)} ·{" "}
                {(st.meta.bytes / 1048576).toFixed(1)} MB
              </div>
              <div className="link-row">
                <button className="link-btn" onClick={() => fileRef.current?.click()} type="button">
                  Replace
                </button>
                <button className="link-btn danger" onClick={st.reset} type="button">
                  Start over
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button className="drop" type="button" onClick={() => fileRef.current?.click()}>
            <svg>
              <use href="#i-up" />
            </svg>
            <div className="drop-t">Drop an image or click to browse</div>
            <div className="drop-s">JPG, PNG or WebP · any ratio</div>
          </button>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={e => {
            readCreative(e.target.files?.[0]);
            e.target.value = "";
          }}
        />

        <div className="row" style={{ marginTop: 10 }}>
          <button className="mini-btn" onClick={onGenerate} type="button">
            Generate
          </button>
          <MiniBtn onClick={() => sample("story", st.loadCreative)}>9:16</MiniBtn>
          <MiniBtn onClick={() => sample("square", st.loadCreative)}>1:1</MiniBtn>
        </div>
      </div>

      {/* ---------- frame-level settings ---------- */}
      <div className="panel">
        <div className="p-head">
          <span className="p-title">Frame</span>
        </div>
        <Field label="Language">
          <select value={d.lang} onChange={e => st.setLang(e.target.value as Lang)}>
            <option value="en">English</option>
            <option value="najdi">Arabic — Najdi (KSA)</option>
            <option value="gulf">Arabic — Gulf (UAE)</option>
            <option value="msa">Arabic — MSA</option>
          </select>
        </Field>
        {st.img ? (
          <>
            <div className="row">
              <MiniBtn on={d.fit === "cover"} onClick={() => st.setFitDefault("cover")}>
                Crop to fill
              </MiniBtn>
              <MiniBtn on={d.fit === "contain"} onClick={() => st.setFitDefault("contain")}>
                Letterbox
              </MiniBtn>
            </div>
            <p className="hint">
              The <b>default</b> for every channel. Any placement can differ — set that on the frame itself.
              {Object.keys(d.fitOverrides).length
                ? ` ${Object.keys(d.fitOverrides).length} ${
                    Object.keys(d.fitOverrides).length === 1 ? "placement overrides" : "placements override"
                  } it.`
                : ""}
            </p>
          </>
        ) : null}
        {/* Picking a layout is the fastest route to something that looks made
            rather than assembled, so it sits above the copy tools. */}
        <div className="p-head" style={{ marginTop: 16 }}>
          <span className="p-title">Layout</span>
        </div>
        <div className="layout-pick">
          {LAYOUTS.map(l => (
            <button
              key={l.id}
              className="layout-opt"
              aria-pressed={st.layout === l.id}
              onClick={() => st.applyLayout(l.id)}
              type="button"
            >
              <b>{l.name}</b>
              <span>{l.note}</span>
            </button>
          ))}
        </div>
        <p className="hint">Changing layout rebuilds the layers, so do it before you start moving things.</p>

        <div className="row" style={{ marginTop: 10 }}>
          <button className="mini-btn" onClick={onGenerate} type="button">
            Write copy with Claude
          </button>
          <MiniBtn
            onClick={() => {
              const pr = PRESETS[d.lang];
              const texts = d.layers.filter(l => l.kind === "text");
              const target = texts[1] ?? texts[0];
              if (target) st.updateLayer(target.id, { text: pr.head });
              const cta = d.layers.find(l => l.kind === "cta");
              if (cta) st.updateLayer(cta.id, { text: pr.cta });
              st.say("Approved tagline applied");
            }}
          >
            Use tagline
          </MiniBtn>
        </div>
      </div>

      {/* ---------- layers ---------- */}
      <LayersPanel />
    </aside>
  );
}
