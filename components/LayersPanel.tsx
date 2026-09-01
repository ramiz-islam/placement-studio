"use client";

/**
 * The layer list and the inspector for whatever is selected.
 *
 * The list reads back-to-front like any design tool: the first row paints
 * first. Everything here edits one layer; nothing is a global setting, which is
 * what makes "another subheading" or "a band behind the logo" the same gesture
 * as any other layer.
 */

import { useRef } from "react";
import { FONTS } from "@/lib/core";
import { ICONS, type CtaLayer, type Fill, type IconLayer, type Layer, type LogoLayer, type ShapeLayer, type TextLayer } from "@/lib/layers";
import { plainText, toggleWord, wordFlags } from "@/lib/geometry";
import { shrinkImage, useStudio } from "./StudioProvider";
import { ColorField, Field, MiniBtn } from "./ui";

/**
 * The textarea shows plain words; the accent markup lives in the stored string.
 * When the text is edited we keep accents for words that survived, by position.
 */
function reflow(stored: string, plain: string): string {
  const flags = wordFlags(stored);
  const words = plain.split(/\s+/).filter(Boolean);
  const next = words.map((word, i) => ({ word, accent: flags[i]?.word === word ? flags[i].accent : false }));
  const rebuilt: string[] = [];
  let i = 0;
  while (i < next.length) {
    const accent = next[i].accent;
    const group: string[] = [];
    while (i < next.length && next[i].accent === accent) {
      group.push(next[i].word);
      i++;
    }
    rebuilt.push(accent ? `[${group.join(" ")}]` : group.join(" "));
  }
  return rebuilt.join(" ");
}

const KIND_ICON: Record<string, string> = {
  text: "T",
  cta: "▭",
  logo: "◈",
  shape: "■",
  icon: "★",
};

export function LayersPanel() {
  const st = useStudio();
  const d = st.design;
  const selected = d.layers.find(l => l.id === st.selectedId) ?? null;

  return (
    <>
      <div className="panel">
        <div className="p-head">
          <span className="p-title">Layers</span>
          <button className="link-btn" onClick={() => st.patchDesign({ copyOn: !d.copyOn })} type="button">
            {d.copyOn ? "Hide all" : "Show all"}
          </button>
        </div>

        <ul className="layer-list">
          {[...d.layers].reverse().map(l => (
            <li
              key={l.id}
              className={`layer-row${st.selectedId === l.id ? " on" : ""}${l.on ? "" : " off"}`}
              onClick={() => st.select(l.id)}
            >
              <span className="lk" aria-hidden="true">
                {KIND_ICON[l.kind]}
              </span>
              <span className="ln-name">{l.name}</span>
              <button
                className="row-btn"
                title={l.on ? "Hide layer" : "Show layer"}
                onClick={e => {
                  e.stopPropagation();
                  st.updateLayer(l.id, { on: !l.on } as Partial<Layer>);
                }}
                type="button"
              >
                {l.on ? "◉" : "○"}
              </button>
              <button
                className="row-btn"
                title="Bring forward"
                onClick={e => {
                  e.stopPropagation();
                  st.reorderLayer(l.id, 1);
                }}
                type="button"
              >
                ↑
              </button>
              <button
                className="row-btn"
                title="Send backward"
                onClick={e => {
                  e.stopPropagation();
                  st.reorderLayer(l.id, -1);
                }}
                type="button"
              >
                ↓
              </button>
            </li>
          ))}
        </ul>

        <div className="add-row">
          <button className="mini-btn" onClick={() => st.addLayer("text")} type="button">
            + Text
          </button>
          <button className="mini-btn" onClick={() => st.addLayer("shape")} type="button">
            + Shape
          </button>
          <button className="mini-btn" onClick={() => st.addLayer("band")} type="button">
            + Band
          </button>
          <button className="mini-btn" onClick={() => st.addLayer("icon")} type="button">
            + Icon
          </button>
          <button className="mini-btn" onClick={() => st.addLayer("cta")} type="button">
            + Button
          </button>
          <button className="mini-btn" onClick={() => st.addLayer("logo")} type="button">
            + Logo
          </button>
        </div>
      </div>

      {selected ? <Inspector layer={selected} /> : (
        <div className="panel">
          <p className="hint">Select a layer to edit it, or drag one directly on the frame.</p>
        </div>
      )}
    </>
  );
}

/* ============================================================
   INSPECTOR
   ============================================================ */

function Inspector({ layer }: { layer: Layer }) {
  const st = useStudio();
  const set = (p: Partial<Layer>) => st.updateLayer(layer.id, p);

  return (
    <div className="panel">
      <div className="p-head">
        <span className="p-title">{layer.kind}</span>
        <div className="link-row">
          <button className="link-btn" onClick={() => st.duplicateLayer(layer.id)} type="button">
            Duplicate
          </button>
          <button className="link-btn danger" onClick={() => st.removeLayer(layer.id)} type="button">
            Delete
          </button>
        </div>
      </div>

      <Field label="Layer name">
        <input type="text" value={layer.name} onChange={e => set({ name: e.target.value } as Partial<Layer>)} />
      </Field>

      {layer.kind === "text" ? <TextInspector l={layer} set={set} /> : null}
      {layer.kind === "cta" ? <CtaInspector l={layer} set={set} /> : null}
      {layer.kind === "logo" ? <LogoInspector l={layer} set={set} /> : null}
      {layer.kind === "shape" ? <ShapeInspector l={layer} set={set} /> : null}
      {layer.kind === "icon" ? <IconInspector l={layer} set={set} /> : null}
    </div>
  );
}

type Set = (p: Partial<Layer>) => void;

/** Colour / gradient / opacity for any Fill. */
function FillFields({ label, fill, onChange }: { label: string; fill: Fill; onChange: (f: Fill) => void }) {
  return (
    <>
      <ColorField label={`${label} colour`} value={fill.color} onChange={hex => onChange({ ...fill, color: hex })} />
      <div className="row">
        <MiniBtn
          on={Boolean(fill.color2)}
          onClick={() => onChange({ ...fill, color2: fill.color2 ? null : "#0038A7" })}
        >
          Gradient
        </MiniBtn>
      </div>
      {fill.color2 ? (
        <>
          <ColorField label={`${label} second colour`} value={fill.color2} onChange={hex => onChange({ ...fill, color2: hex })} />
          <Field label="Gradient angle" hint={`${fill.angle}°`}>
            <input
              type="range"
              min={0}
              max={360}
              step={5}
              value={fill.angle}
              onChange={e => onChange({ ...fill, angle: Number(e.target.value) })}
            />
          </Field>
        </>
      ) : null}
      <Field label={`${label} opacity`} hint={`${fill.opacity}%`}>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={fill.opacity}
          onChange={e => onChange({ ...fill, opacity: Number(e.target.value) })}
        />
      </Field>
    </>
  );
}

function TextInspector({ l, set }: { l: TextLayer; set: Set }) {
  const st = useStudio();
  const rtl = st.design.lang !== "en";
  return (
    <>
      <Field label="Text" hint={`${plainText(l.text).length} ch`}>
        <textarea
          value={plainText(l.text)}
          dir={rtl ? "rtl" : "ltr"}
          onChange={e => set({ text: reflow(l.text, e.target.value) } as Partial<Layer>)}
          style={{ minHeight: 56 }}
        />
      </Field>

      <Field label="Second colour" hint="tap a word">
        <div className="word-pick" dir={rtl ? "rtl" : undefined}>
          {wordFlags(l.text).map((wf, i) => (
            <button
              key={`${i}-${wf.word}`}
              className="word"
              aria-pressed={wf.accent}
              type="button"
              style={wf.accent ? { color: l.color2, borderColor: l.color2 } : undefined}
              onClick={() => set({ text: toggleWord(l.text, i) } as Partial<Layer>)}
            >
              {wf.word}
            </button>
          ))}
        </div>
        <p className="hint">
          Tap any word to flip it to the second colour. Tap again to put it back.
        </p>
      </Field>

      <Field label="Font">
        <select value={l.font} onChange={e => set({ font: e.target.value } as Partial<Layer>)}>
          {FONTS.map(f => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Size" hint={`${l.size.toFixed(1)}% width`}>
        <input
          type="range"
          min={1}
          max={16}
          step={0.1}
          value={l.size}
          onChange={e => set({ size: parseFloat(e.target.value) } as Partial<Layer>)}
        />
      </Field>
      <Field label="Block width" hint={`${l.blockW}% width`}>
        <input
          type="range"
          min={20}
          max={96}
          step={1}
          value={l.blockW}
          onChange={e => set({ blockW: Number(e.target.value) } as Partial<Layer>)}
        />
      </Field>
      <Field label="Line height" hint={l.lineHeight == null ? "font default" : l.lineHeight.toFixed(2)}>
        <input
          type="range"
          min={0.9}
          max={2}
          step={0.02}
          value={l.lineHeight ?? 1.15}
          onChange={e => set({ lineHeight: parseFloat(e.target.value) } as Partial<Layer>)}
        />
      </Field>
      <Field label="Letter spacing" hint={`${l.tracking.toFixed(2)}em`}>
        <input
          type="range"
          min={-0.05}
          max={0.4}
          step={0.01}
          value={l.tracking}
          onChange={e => set({ tracking: parseFloat(e.target.value) } as Partial<Layer>)}
        />
      </Field>
      <div className="row">
        <MiniBtn on={l.upper} onClick={() => set({ upper: !l.upper } as Partial<Layer>)}>
          UPPERCASE
        </MiniBtn>
        <MiniBtn on={l.scrim.on} onClick={() => set({ scrim: { ...l.scrim, on: !l.scrim.on } } as Partial<Layer>)}>
          Scrim
        </MiniBtn>
      </div>

      <ColorField label="Colour" value={l.color} onChange={hex => set({ color: hex } as Partial<Layer>)} />
      <ColorField label="Second colour" value={l.color2} onChange={hex => set({ color2: hex } as Partial<Layer>)} />

      {l.scrim.on ? (
        <div className="subpanel">
          <FillFields label="Scrim" fill={l.scrim.fill} onChange={f => set({ scrim: { ...l.scrim, fill: f } } as Partial<Layer>)} />
          <Field label="Scrim padding" hint={`${l.scrim.pad}% of type size`}>
            <input
              type="range"
              min={0}
              max={150}
              step={5}
              value={l.scrim.pad}
              onChange={e => set({ scrim: { ...l.scrim, pad: Number(e.target.value) } } as Partial<Layer>)}
            />
          </Field>
          <Field label="Scrim radius" hint={`${l.scrim.radius}%`}>
            <input
              type="range"
              min={0}
              max={100}
              step={2}
              value={l.scrim.radius}
              onChange={e => set({ scrim: { ...l.scrim, radius: Number(e.target.value) } } as Partial<Layer>)}
            />
          </Field>
        </div>
      ) : null}
    </>
  );
}

function CtaInspector({ l, set }: { l: CtaLayer; set: Set }) {
  return (
    <>
      <Field label="Label" hint={`${l.text.length} ch`}>
        <input type="text" value={l.text} onChange={e => set({ text: e.target.value } as Partial<Layer>)} />
      </Field>
      <Field label="Font">
        <select value={l.font} onChange={e => set({ font: e.target.value } as Partial<Layer>)}>
          {FONTS.map(f => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Size" hint={`${l.size.toFixed(1)}% width`}>
        <input
          type="range"
          min={1.5}
          max={9}
          step={0.1}
          value={l.size}
          onChange={e => set({ size: parseFloat(e.target.value) } as Partial<Layer>)}
        />
      </Field>
      <Field label="Corner radius" hint={l.radius >= 50 ? "pill" : `${l.radius}%`}>
        <input
          type="range"
          min={0}
          max={50}
          step={1}
          value={l.radius}
          onChange={e => set({ radius: Number(e.target.value) } as Partial<Layer>)}
        />
      </Field>
      <FillFields label="Fill" fill={l.bg} onChange={f => set({ bg: f } as Partial<Layer>)} />
      <ColorField label="Label colour" value={l.ink} onChange={hex => set({ ink: hex } as Partial<Layer>)} />
    </>
  );
}

function LogoInspector({ l, set }: { l: LogoLayer; set: Set }) {
  const st = useStudio();
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <>
      {st.logoSrc ? (
        <div className="creative" style={{ marginBottom: 10 }}>
          <div className="creative-thumb pad">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={st.logoSrc} alt="" />
          </div>
          <div className="creative-meta">
            <div className="creative-name">Logo loaded</div>
            <div className="link-row">
              <button className="link-btn" onClick={() => fileRef.current?.click()} type="button">
                Replace
              </button>
              <button className="link-btn danger" onClick={st.clearLogo} type="button">
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button className="drop tight" type="button" onClick={() => fileRef.current?.click()}>
          <svg>
            <use href="#i-up" />
          </svg>
          <div className="drop-t">Add a logo</div>
          <div className="drop-s">PNG with transparency · saved to your kit</div>
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={async e => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          const fr = new FileReader();
          fr.onload = async ev => st.loadLogo(await shrinkImage(String(ev.target?.result), 640));
          fr.readAsDataURL(f);
        }}
      />

      <Field label="Width" hint={`${l.w}% of frame`}>
        <input
          type="range"
          min={4}
          max={60}
          step={1}
          value={l.w}
          onChange={e => set({ w: Number(e.target.value) } as Partial<Layer>)}
        />
      </Field>

      <div className="row">
        <MiniBtn on={l.plate.on} onClick={() => set({ plate: { ...l.plate, on: !l.plate.on } } as Partial<Layer>)}>
          Scrim
        </MiniBtn>
        <MiniBtn on={l.band.on} onClick={() => set({ band: { ...l.band, on: !l.band.on } } as Partial<Layer>)}>
          Full-width band
        </MiniBtn>
      </div>

      {l.plate.on ? (
        <div className="subpanel">
          <FillFields label="Scrim" fill={l.plate.fill} onChange={f => set({ plate: { ...l.plate, fill: f } } as Partial<Layer>)} />
          <Field label="Scrim padding" hint={`${l.plate.pad}% of logo`}>
            <input
              type="range"
              min={0}
              max={60}
              step={1}
              value={l.plate.pad}
              onChange={e => set({ plate: { ...l.plate, pad: Number(e.target.value) } } as Partial<Layer>)}
            />
          </Field>
          <Field label="Scrim radius" hint={l.plate.radius >= 50 ? "pill" : `${l.plate.radius}%`}>
            <input
              type="range"
              min={0}
              max={50}
              step={1}
              value={l.plate.radius}
              onChange={e => set({ plate: { ...l.plate, radius: Number(e.target.value) } } as Partial<Layer>)}
            />
          </Field>
        </div>
      ) : null}

      {l.band.on ? (
        <div className="subpanel">
          <FillFields label="Band" fill={l.band.fill} onChange={f => set({ band: { ...l.band, fill: f } } as Partial<Layer>)} />
          <Field label="Band height" hint={`${l.band.pad}% of logo above and below`}>
            <input
              type="range"
              min={0}
              max={120}
              step={2}
              value={l.band.pad}
              onChange={e => set({ band: { ...l.band, pad: Number(e.target.value) } } as Partial<Layer>)}
            />
          </Field>
          <p className="hint">
            A full-bleed strip across the frame that moves with the logo. Turn on <b>Gradient</b> to fade it out.
          </p>
        </div>
      ) : null}
    </>
  );
}

function ShapeInspector({ l, set }: { l: ShapeLayer; set: Set }) {
  const shapeFileRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <Field label="Shape">
        <select value={l.shape} onChange={e => set({ shape: e.target.value as ShapeLayer["shape"] } as Partial<Layer>)}>
          <option value="rect">Rectangle</option>
          <option value="ellipse">Ellipse</option>
          <option value="triangle">Triangle</option>
          <option value="band">Band — full frame width</option>
          <option value="line">Line</option>
        </select>
      </Field>
      {l.shape !== "band" ? (
        <Field label="Width" hint={`${l.w}% of frame`}>
          <input
            type="range"
            min={2}
            max={100}
            step={1}
            value={l.w}
            onChange={e => set({ w: Number(e.target.value) } as Partial<Layer>)}
          />
        </Field>
      ) : null}
      <Field label="Height" hint={`${l.h}% of frame`}>
        <input
          type="range"
          min={l.shape === "line" ? 0.2 : 1}
          max={100}
          step={l.shape === "line" ? 0.2 : 1}
          value={l.h}
          onChange={e => set({ h: parseFloat(e.target.value) } as Partial<Layer>)}
        />
      </Field>
      {l.shape !== "ellipse" ? (
        <Field label="Corner radius" hint={`${l.radius}%`}>
          <input
            type="range"
            min={0}
            max={50}
            step={1}
            value={l.radius}
            onChange={e => set({ radius: Number(e.target.value) } as Partial<Layer>)}
          />
        </Field>
      ) : null}
      {l.src ? (
        <div className="creative" style={{ marginBottom: 10 }}>
          <div className="creative-thumb pad">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={l.src} alt="" />
          </div>
          <div className="creative-meta">
            <div className="creative-name">Image inside the shape</div>
            <div className="creative-dims">cropped to fill, clipped to the shape</div>
            <div className="link-row">
              <button className="link-btn" onClick={() => shapeFileRef.current?.click()} type="button">
                Replace
              </button>
              <button className="link-btn danger" onClick={() => set({ src: null } as Partial<Layer>)} type="button">
                Back to flat colour
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <FillFields label="Fill" fill={l.fill} onChange={f => set({ fill: f } as Partial<Layer>)} />
          <button className="mini-btn" onClick={() => shapeFileRef.current?.click()} type="button">
            Upload an image instead
          </button>
        </>
      )}
      <input
        ref={shapeFileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={async e => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          const fr = new FileReader();
          fr.onload = async ev => set({ src: await shrinkImage(String(ev.target?.result), 1200) } as Partial<Layer>);
          fr.readAsDataURL(f);
        }}
      />
    </>
  );
}

function IconInspector({ l, set }: { l: IconLayer; set: Set }) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <Field label="Icon">
        <div className="icon-grid">
          {ICONS.map(i => (
            <button
              key={i.id}
              className="icon-pick"
              aria-pressed={l.icon === i.id && !l.src}
              title={i.label}
              type="button"
              onClick={() => set({ icon: i.id, src: null } as Partial<Layer>)}
            >
              <svg viewBox="0 0 24 24">
                <path d={i.d} />
              </svg>
            </button>
          ))}
        </div>
      </Field>

      {l.src ? (
        <div className="creative" style={{ marginBottom: 10 }}>
          <div className="creative-thumb pad">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={l.src} alt="" />
          </div>
          <div className="creative-meta">
            <div className="creative-name">Custom icon</div>
            <div className="link-row">
              <button className="link-btn" onClick={() => fileRef.current?.click()} type="button">
                Replace
              </button>
              <button className="link-btn danger" onClick={() => set({ src: null } as Partial<Layer>)} type="button">
                Use a built-in
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button className="mini-btn" onClick={() => fileRef.current?.click()} type="button">
          Upload your own
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={async e => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          const fr = new FileReader();
          fr.onload = async ev => set({ src: await shrinkImage(String(ev.target?.result), 256) } as Partial<Layer>);
          fr.readAsDataURL(f);
        }}
      />

      <Field label="Size" hint={`${l.w}% of frame`}>
        <input
          type="range"
          min={2}
          max={40}
          step={1}
          value={l.w}
          onChange={e => set({ w: Number(e.target.value) } as Partial<Layer>)}
        />
      </Field>
      {!l.src ? <ColorField label="Colour" value={l.color} onChange={hex => set({ color: hex } as Partial<Layer>)} /> : null}

      <div className="row">
        <MiniBtn on={l.scrim.on} onClick={() => set({ scrim: { ...l.scrim, on: !l.scrim.on } } as Partial<Layer>)}>
          Scrim
        </MiniBtn>
      </div>
      {l.scrim.on ? (
        <div className="subpanel">
          <FillFields label="Scrim" fill={l.scrim.fill} onChange={f => set({ scrim: { ...l.scrim, fill: f } } as Partial<Layer>)} />
          <Field label="Scrim padding" hint={`${l.scrim.pad}% of icon`}>
            <input
              type="range"
              min={0}
              max={100}
              step={2}
              value={l.scrim.pad}
              onChange={e => set({ scrim: { ...l.scrim, pad: Number(e.target.value) } } as Partial<Layer>)}
            />
          </Field>
          <Field label="Scrim radius" hint={l.scrim.radius >= 50 ? "circle" : `${l.scrim.radius}%`}>
            <input
              type="range"
              min={0}
              max={50}
              step={1}
              value={l.scrim.radius}
              onChange={e => set({ scrim: { ...l.scrim, radius: Number(e.target.value) } } as Partial<Layer>)}
            />
          </Field>
        </div>
      ) : null}
    </>
  );
}
