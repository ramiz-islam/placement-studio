"use client";

import { useEffect, useRef, useState } from "react";
import { FONTS, KIT_DEFAULTS, type BrandKit } from "@/lib/core";
import { shrinkImage, useStudio } from "./StudioProvider";
import { ColorField, Field, Sheet } from "./ui";

export function BrandKitSheet({
  open,
  firstRun,
  onClose,
}: {
  open: boolean;
  firstRun: boolean;
  onClose: () => void;
}) {
  const st = useStudio();
  const [draft, setDraft] = useState<BrandKit>(st.kit);
  const logoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setDraft(st.kit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const patch = (p: Partial<BrandKit>) => setDraft(prev => ({ ...prev, ...p }));

  return (
    <Sheet
      open={open}
      onClose={onClose}
      narrow
      title={firstRun ? "Set up your brand kit" : "Brand kit"}
      sub={
        firstRun
          ? "Asked once. Saved in this browser and applied to every creative from now on."
          : "Saved in this browser and applied to every creative."
      }
      foot={
        <>
          <button
            className="btn"
            type="button"
            onClick={() => {
              st.forgetKit();
              setDraft(KIT_DEFAULTS);
            }}
          >
            Forget saved kit
          </button>
          <button
            className="btn primary"
            type="button"
            onClick={() => {
              st.applyKit({ ...draft, brand: draft.brand.trim() || KIT_DEFAULTS.brand, logo: st.logoSrc });
              onClose();
              st.say("Brand kit saved — applied from now on");
            }}
          >
            Save and apply
          </button>
        </>
      }
    >
      <Field label="Brand name">
        <input
          type="text"
          value={draft.brand}
          placeholder="CarSwitch"
          onChange={e => patch({ brand: e.target.value })}
        />
      </Field>

      <Field label={<>Logo <span className="p-note">PNG with transparency works best</span></>}>
        {st.logoSrc ? (
          <div className="creative">
            <div className="creative-thumb pad">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={st.logoSrc} alt="" />
            </div>
            <div className="creative-meta">
              <div className="creative-name">Logo loaded</div>
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
        ) : (
          <button className="drop tight" type="button" onClick={() => logoRef.current?.click()}>
            <svg>
              <use href="#i-up" />
            </svg>
            <div className="drop-t">Add a logo</div>
            <div className="drop-s">Saved with your kit</div>
          </button>
        )}
        <input
          ref={logoRef}
          type="file"
          accept="image/*"
          hidden
          onChange={async e => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            const fr = new FileReader();
            fr.onload = async ev => st.loadLogo(await shrinkImage(String(ev.target?.result), 512));
            fr.readAsDataURL(f);
          }}
        />
      </Field>

      <div className="kit-grid">
        <Field label="Headline font">
          <select value={draft.headFont} onChange={e => patch({ headFont: e.target.value })}>
            {FONTS.map(f => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </Field>
        <ColorField label="Headline colour" value={draft.headColor} onChange={hex => patch({ headColor: hex })} swatches={false} />
        <ColorField label="CTA background" value={draft.ctaBg} onChange={hex => patch({ ctaBg: hex })} swatches={false} />
        <ColorField label="CTA text" value={draft.ctaInk} onChange={hex => patch({ ctaInk: hex })} swatches={false} />
      </div>

      <div className="notice">
        Loaded with CarSwitch defaults — Night Sky <b>#141652</b>, Sunset <b>#FF5450</b>, Fields <b>#BFFF00</b>, Plus
        Jakarta Sans. The brand book&apos;s rule of three still applies: one light neutral plus two bold colours, one of
        which must be Night Sky or Sunset.
      </div>
    </Sheet>
  );
}
