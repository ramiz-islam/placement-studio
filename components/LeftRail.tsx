"use client";

import { useRef } from "react";
import { PRESETS, type Lang } from "@/lib/core";
import { RATIO_LABEL } from "@/lib/geometry";
import { useStudio } from "./StudioProvider";
import { FigmaPanel } from "./FigmaPanel";
import { Field, MiniBtn } from "./ui";
import { LayersPanel } from "./LayersPanel";
import { sample } from "./Stage";

/** Photoshop files arrive with an empty type more often than not; trust the extension. */
export const isPsd = (f: File) =>
  /\.psd$/i.test(f.name) || f.type === "image/vnd.adobe.photoshop";

export function LeftRail({ onGenerate }: { onGenerate: () => void }) {
  const st = useStudio();
  const fileRef = useRef<HTMLInputElement>(null);
  const psdRef = useRef<HTMLInputElement>(null);
  /** set by the "flat" link before opening the picker, read once in onChange */
  const psdFlat = useRef(false);
  const d = st.design;

  const readCreative = (f: File | undefined) => {
    if (!f) return;
    // A PSD goes to the importer. Checked by name as well as type: Windows and
    // some browsers report a Photoshop file's MIME type as empty, which is how
    // a layered file dropped here got "Images only for now".
    if (isPsd(f)) return void st.importPsd(f);
    if (!f.type.startsWith("image/")) return st.say("Images only for now");
    const fr = new FileReader();
    fr.onload = (e) =>
      st.loadCreative(String(e.target?.result), f.name, f.size);
    fr.readAsDataURL(f);
  };

  return (
    <aside className="col col-left">
      {/* ---------- creative ---------- */}
      <div className="panel">
        <div className="p-head">
          <span className="p-title">Creative</span>
          <span className="p-note">
            {st.meta ? `${RATIO_LABEL(st.meta.w / st.meta.h)} source` : ""}
          </span>
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
                {st.meta.w} × {st.meta.h} · {RATIO_LABEL(st.meta.w / st.meta.h)}{" "}
                · {(st.meta.bytes / 1048576).toFixed(1)} MB
              </div>
              <div className="link-row">
                <button
                  className="link-btn"
                  onClick={() => fileRef.current?.click()}
                  type="button"
                >
                  Replace
                </button>
                <button
                  className="link-btn"
                  onClick={() => {
                    psdFlat.current = false;
                    psdRef.current?.click();
                  }}
                  type="button"
                >
                  {st.importing ? "Importing…" : "Import PSD"}
                </button>
                <button
                  className="link-btn"
                  title="Photoshop's own flattened image, exactly as the file looks — no editable layers, but nothing lost"
                  onClick={() => {
                    psdFlat.current = true;
                    psdRef.current?.click();
                  }}
                  type="button"
                >
                  PSD, flat
                </button>
                <button
                  className="link-btn danger"
                  onClick={st.reset}
                  type="button"
                >
                  Start over
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <button
              className="drop"
              type="button"
              onClick={() => fileRef.current?.click()}
            >
              <svg>
                <use href="#i-up" />
              </svg>
              <div className="drop-t">Drop an image or click to browse</div>
              <div className="drop-s">JPG, PNG or WebP · any ratio</div>
            </button>
            <div
              className="link-row"
              style={{ justifyContent: "center", marginTop: 8 }}
            >
              <button
                className="link-btn"
                onClick={() => {
                  psdFlat.current = false;
                  psdRef.current?.click();
                }}
                type="button"
              >
                Import a PSD as layers
              </button>
              <button
                className="link-btn"
                title="Photoshop's own flattened image, exactly as the file looks — no editable layers, but nothing lost"
                onClick={() => {
                  psdFlat.current = true;
                  psdRef.current?.click();
                }}
                type="button"
              >
                or flat
              </button>
            </div>
          </>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            readCreative(e.target.files?.[0]);
            e.target.value = "";
          }}
        />

        <input
          ref={psdRef}

          type="file"

          accept=".psd,image/vnd.adobe.photoshop"

          hidden

          onChange={(e) => {
            const f = e.target.files?.[0];

            e.target.value = "";

            if (f) void st.importPsd(f, { flatten: psdFlat.current });

            psdFlat.current = false;
          }}
        />

        <div className="row" style={{ marginTop: 10 }}>
          <button className="mini-btn" onClick={onGenerate} type="button">
            Generate
          </button>
          <MiniBtn onClick={() => sample("story", st.loadCreative)}>
            9:16
          </MiniBtn>
          <MiniBtn onClick={() => sample("square", st.loadCreative)}>
            1:1
          </MiniBtn>
        </div>
      </div>

      <FigmaPanel />

      {/* ---------- frame-level settings ---------- */}
      <div className="panel">
        <div className="p-head">
          <span className="p-title">Frame</span>
        </div>
        <Field label="Language">
          <select
            value={d.lang}
            onChange={(e) => st.setLang(e.target.value as Lang)}
          >
            <option value="en">English</option>
            <option value="najdi">Arabic — Najdi (KSA)</option>
            <option value="gulf">Arabic — Gulf (UAE)</option>
            <option value="msa">Arabic — MSA</option>
          </select>
        </Field>
        {st.img ? (
          <>
            <div className="row">
              <MiniBtn
                on={d.fit === "cover"}
                onClick={() => st.setFitDefault("cover")}
              >
                Crop to fill
              </MiniBtn>
              <MiniBtn
                on={d.fit === "contain"}
                onClick={() => st.setFitDefault("contain")}
              >
                Letterbox
              </MiniBtn>
            </div>
            <p className="hint">
              The <b>default</b> for every channel. Any placement can differ —
              set that on the frame itself.
              {Object.keys(d.fitOverrides).length
                ? ` ${Object.keys(d.fitOverrides).length} ${
                    Object.keys(d.fitOverrides).length === 1
                      ? "placement overrides"
                      : "placements override"
                  } it.`
                : ""}
            </p>
          </>
        ) : null}
        {/* The one thing that makes a brand block work on a photograph of a
            person: without a cut-out, every shape is in front of them. */}
        <div className="row" style={{ marginTop: 10 }}>
          <button
            className="mini-btn"
            disabled={!st.src || st.cuttingOut}
            title="Puts the subject on a layer of its own, so a shape can sit behind them"
            onClick={() => void st.cutOutSubject()}
            type="button"
          >
            {st.cuttingOut ? "Cutting out…" : "Cut out the subject"}
          </button>
        </div>

        <div className="row" style={{ marginTop: 10 }}>
          <button className="mini-btn" onClick={onGenerate} type="button">
            Write copy with Claude
          </button>
          <MiniBtn
            onClick={() => {
              const pr = PRESETS[d.lang];
              const texts = d.layers.filter((l) => l.kind === "text");
              const target = texts[1] ?? texts[0];
              if (target) st.updateLayer(target.id, { text: pr.head });
              const cta = d.layers.find((l) => l.kind === "cta");
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
