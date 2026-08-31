"use client";

import { useRef } from "react";
import { FONTS, PRESETS, isRTL, type Lang } from "@/lib/core";
import { RATIO_LABEL } from "@/lib/geometry";
import { shrinkImage, useStudio } from "./StudioProvider";
import { ColorField, Field, MiniBtn } from "./ui";
import { sample } from "./Stage";

export function LeftRail({ onGenerate }: { onGenerate: () => void }) {
  const st = useStudio();
  const fileRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const d = st.design;
  const rtl = isRTL(d.lang);

  const readCreative = (f: File | undefined) => {
    if (!f || !f.type.startsWith("image/")) return st.say("Images only for now");
    const fr = new FileReader();
    fr.onload = e => st.loadCreative(String(e.target?.result), f.name, f.size);
    fr.readAsDataURL(f);
  };
  const readLogo = (f: File | undefined) => {
    if (!f || !f.type.startsWith("image/")) return st.say("Images only for now");
    const fr = new FileReader();
    fr.onload = async e => st.loadLogo(await shrinkImage(String(e.target?.result), 512));
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
          <MiniBtn onClick={() => sample("story", st.loadCreative)}>9:16 sample</MiniBtn>
          <MiniBtn onClick={() => sample("square", st.loadCreative)}>1:1 sample</MiniBtn>
        </div>
      </div>

      {/* ---------- fit ---------- */}
      {st.img ? (
        <div className="panel">
          <div className="p-head">
            <span className="p-title">Fit into placement</span>
          </div>
          <div className="row">
            <MiniBtn on={d.fit === "cover"} onClick={() => st.patchDesign({ fit: "cover" })}>
              Crop to fill
            </MiniBtn>
            <MiniBtn on={d.fit === "contain"} onClick={() => st.patchDesign({ fit: "contain" })}>
              Letterbox
            </MiniBtn>
          </div>
          <p className="hint">
            {d.fit === "cover"
              ? "Crop to fill is how every feed renders a mismatched ratio — it is the honest preview."
              : "Letterboxing keeps the whole frame but reads as a repurposed asset. Use it to see what you are losing."}
          </p>
        </div>
      ) : null}

      {/* ---------- copy ---------- */}
      <div className="panel">
        <div className="p-head">
          <span className="p-title">Copy layers</span>
          <button className="link-btn" onClick={() => st.patchDesign({ copyOn: !d.copyOn })} type="button">
            {d.copyOn ? "Hide" : "Show"}
          </button>
        </div>

        {d.copyOn ? (
          <>
            <Field label="Language">
              <select value={d.lang} onChange={e => st.setLang(e.target.value as Lang)}>
                <option value="en">English</option>
                <option value="najdi">Arabic — Najdi (KSA)</option>
                <option value="gulf">Arabic — Gulf (UAE)</option>
                <option value="msa">Arabic — MSA</option>
              </select>
            </Field>

            <Field label="Brand line" hint={`${d.brand.length} ch`}>
              <input type="text" value={d.brand} dir={rtl ? "rtl" : "ltr"} onChange={e => st.patchDesign({ brand: e.target.value })} />
            </Field>
            <Field label="Headline" hint={`${d.head.length} ch`}>
              <input type="text" value={d.head} dir={rtl ? "rtl" : "ltr"} onChange={e => st.patchDesign({ head: e.target.value })} />
            </Field>
            <Field label="Call to action" hint={`${d.cta.length} ch`}>
              <input type="text" value={d.cta} dir={rtl ? "rtl" : "ltr"} onChange={e => st.patchDesign({ cta: e.target.value })} />
            </Field>

            <div className="row" style={{ marginBottom: 10 }}>
              <button className="mini-btn" onClick={onGenerate} type="button">
                Write copy with Claude
              </button>
              <MiniBtn
                onClick={() => {
                  const pr = PRESETS[d.lang];
                  st.patchDesign({ head: pr.head, cta: pr.cta });
                }}
              >
                Use tagline
              </MiniBtn>
            </div>

            <Field label="Headline font">
              <select value={d.headFont} onChange={e => st.patchDesign({ headFont: e.target.value })}>
                {FONTS.map(f => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Headline size" hint={`${d.size.toFixed(1)}% width`}>
              <input
                type="range"
                min={3}
                max={15}
                step={0.25}
                value={d.size}
                onChange={e => st.patchDesign({ size: parseFloat(e.target.value) })}
              />
            </Field>
            <Field label="Text block width" hint={`${d.blockW}% width`}>
              <input
                type="range"
                min={30}
                max={96}
                step={1}
                value={d.blockW}
                onChange={e => st.patchDesign({ blockW: Number(e.target.value) })}
              />
            </Field>

            <ColorField label="Headline colour" value={d.headColor} onChange={hex => st.patchDesign({ headColor: hex })} />
            <ColorField label="CTA background" value={d.ctaBg} onChange={hex => st.patchDesign({ ctaBg: hex })} />
            <ColorField label="CTA text" value={d.ctaInk} onChange={hex => st.patchDesign({ ctaInk: hex })} />

            <div className="row">
              <MiniBtn on={d.scrim} onClick={() => st.patchDesign({ scrim: !d.scrim })}>
                Scrim behind copy
              </MiniBtn>
            </div>
          </>
        ) : null}
      </div>

      {/* ---------- logo ---------- */}
      <div className="panel">
        <div className="p-head">
          <span className="p-title">Logo</span>
          <span className="p-note">
            {st.logo ? `${st.logo.naturalWidth} × ${st.logo.naturalHeight}` : "not set"}
          </span>
        </div>

        {st.logoSrc ? (
          <>
            <div className="creative">
              <div className="creative-thumb pad">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={st.logoSrc} alt="" />
              </div>
              <div className="creative-meta">
                <div className="creative-name">Logo loaded</div>
                <div className="creative-dims">drag it on the frame to position</div>
                <div className="link-row">
                  <button className="link-btn" onClick={() => logoRef.current?.click()} type="button">
                    Replace
                  </button>
                  <button className="link-btn danger" onClick={st.clearLogo} type="button">
                    Remove
                  </button>
                </div>
              </div>
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label className="f-label">
                <span>Logo width</span>
                <b>{d.logoW}% width</b>
              </label>
              <input
                type="range"
                min={6}
                max={45}
                step={1}
                value={d.logoW}
                onChange={e => st.patchDesign({ logoW: Number(e.target.value) })}
              />
            </div>
          </>
        ) : (
          <button className="drop tight" type="button" onClick={() => logoRef.current?.click()}>
            <svg>
              <use href="#i-up" />
            </svg>
            <div className="drop-t">Add a logo</div>
            <div className="drop-s">PNG with transparency · saved to your kit</div>
          </button>
        )}

        <input
          ref={logoRef}
          type="file"
          accept="image/*"
          hidden
          onChange={e => {
            readLogo(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
    </aside>
  );
}
