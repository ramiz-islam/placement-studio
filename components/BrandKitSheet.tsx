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
              st.applyKit({ ...draft, brand: draft.brand.trim() || KIT_DEFAULTS.brand, logo: st.logoSrc, logos: st.kit.logos });
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

      <Field
        label={
          <>
            Logos <span className="p-note">primary first · PNG with transparency works best</span>
          </>
        }
      >
        {st.kit.logos.length ? (
          <div className="logo-list">
            {st.kit.logos.map((k, i) => (
              <div className="logo-row" key={k.id}>
                <div className="creative-thumb pad">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={st.logoSrcs[k.id] ?? k.src} alt="" />
                </div>
                <div className="creative-meta">
                  <input
                    className="logo-name"
                    type="text"
                    value={k.name}
                    aria-label="Logo name"
                    onChange={e => st.renameKitLogo(k.id, e.target.value)}
                  />
                  <div className="link-row">
                    {i === 0 ? (
                      <span className="p-note">Primary — used unless a layer picks another</span>
                    ) : (
                      <button className="link-btn" onClick={() => st.makePrimaryLogo(k.id)} type="button">
                        Make primary
                      </button>
                    )}
                    <button className="link-btn danger" onClick={() => st.removeKitLogo(k.id)} type="button">
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        <button className="drop tight" type="button" onClick={() => logoRef.current?.click()}>
          <svg>
            <use href="#i-up" />
          </svg>
          <div className="drop-t">{st.kit.logos.length ? "Add another logo" : "Add a logo"}</div>
          <div className="drop-s">Emblem, mono version, favicon — pick per layer while designing</div>
        </button>
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
            fr.onload = async ev =>
              st.addKitLogo(
                await shrinkImage(String(ev.target?.result), 512),
                f.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ")
              );
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
        <ColorField
          label="Second headline colour"
          value={draft.headColor2}
          onChange={hex => patch({ headColor2: hex })}
          swatches={false}
        />
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
