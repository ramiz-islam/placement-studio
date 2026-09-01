"use client";

/**
 * Phase 2 — make the creative, then judge it in the same window.
 *
 * Two halves, deliberately separate:
 *  · Picture  — OpenAI gpt-image, generated WITHOUT text so the studio's own
 *               layers can carry copy that is positionable, translatable and
 *               checkable against every safe zone.
 *  · Words    — Claude, because Najdi and Khaleeji register is the whole job.
 */

import { useEffect, useState } from "react";
import { CREATIVE_TYPES, MARKETS, PLACEMENTS, SHAPES, isRTL, type Lang } from "@/lib/core";
import { audit } from "@/lib/audit";
import { reservedEverywhere, reservedForShape } from "@/lib/prompt";
import { shrinkImage, useStudio } from "./StudioProvider";
import { Field, MiniBtn, Sheet, Spinner } from "./ui";

interface GenResult {
  id: string;
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
  savedToLibrary: boolean;
}
/** how a generation actually scored across the whole placement set */
interface Verdict {
  median: number;
  worst: number;
  worstName: string;
  clears: number;
}
interface CopyVariant {
  headline: string;
  cta: string;
  note?: string;
}
interface LibEntry {
  id: string;
  brief: string;
  createdAt: string;
}

const hashId = (str: string) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = (h ^ str.charCodeAt(i)) * 16777619;
  return h | 0;
};

export function GenerateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const st = useStudio();
  const d = st.design;

  const [tab, setTab] = useState<"picture" | "words">("picture");
  const [typeId, setTypeId] = useState("hero");
  const [brief, setBrief] = useState("");
  const [shapeId, setShapeId] = useState("vertical");
  const [market, setMarket] = useState("ksa");
  const [count, setCount] = useState(1);
  const [quality, setQuality] = useState<"low" | "medium" | "high">("high");
  const [includeText, setIncludeText] = useState(false);
  const [useReference, setUseReference] = useState(false);
  const [universal, setUniversal] = useState(true);
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [results, setResults] = useState<GenResult[]>([]);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [library, setLibrary] = useState<LibEntry[]>([]);

  const [copyBrief, setCopyBrief] = useState("");
  const [copyLang, setCopyLang] = useState<Lang>(d.lang);
  const [variants, setVariants] = useState<CopyVariant[]>([]);
  const [copyBusy, setCopyBusy] = useState(false);
  const [copyErr, setCopyErr] = useState<string | null>(null);

  const shape = SHAPES.find(s => s.id === shapeId)!;
  const zone = universal ? reservedEverywhere() : reservedForShape(shapeId);
  const type = CREATIVE_TYPES.find(t => t.id === typeId)!;
  const isRemake = typeId === "remake";

  useEffect(() => {
    if (!open) return;
    fetch("/api/library")
      .then(r => r.json())
      .then(j => setLibrary(j.entries ?? []))
      .catch(() => setLibrary([]));
  }, [open, results.length]);

  useEffect(() => {
    if (isRemake) setUseReference(true);
  }, [isRemake]);

  async function generate() {
    setErr(null);
    if (!brief.trim()) return setErr("Describe what to make first.");
    if (useReference && !st.src) return setErr("Load a creative first, or turn the reference off.");
    setBusy(true);
    setResults([]);
    try {
      // Serverless request bodies cap at ~4.5 MB and the model only needs the
      // reference for composition, so send a 1024px version rather than the
      // full creative.
      const reference = useReference && st.src ? await shrinkImage(st.src, 1024) : null;
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          typeId,
          brief,
          shapeId,
          market,
          brandName: st.kit.brand,
          palette: { headColor: d.headColor, ctaBg: d.ctaBg, ctaInk: d.ctaInk },
          includeText,
          headline: d.head,
          cta: d.cta,
          hasReference: useReference,
          reference,
          count,
          quality,
          universal,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Generation failed.");
      setResults(j.results ?? []);
      setPrompt(j.prompt ?? null);
      setVerdicts({});
      scoreAll(j.results ?? []);
      const saved = (j.results ?? []).every((x: GenResult) => x.savedToLibrary);
      st.say(
        `${j.results.length} ${j.results.length === 1 ? "image" : "images"} generated` +
          (saved ? " and saved to the library" : " — but not saved to the library")
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Score the generation against all placements right here, before any more
   * credits get spent. A result that only clears a handful is worth re-rolling
   * with a tighter brief rather than carrying into the studio.
   */
  async function scoreAll(list: GenResult[]) {
    for (const r of list) {
      const img = new Image();
      const ok = await new Promise<boolean>(res => {
        img.onload = () => res(true);
        img.onerror = () => res(false);
        img.src = r.dataUrl;
      });
      if (!ok) continue;
      // a ver nobody else uses, so this never pollutes the studio analysis cache
      const ver = -Math.abs(hashId(r.id));
      const scores = PLACEMENTS.map(pl => ({
        pl,
        score: audit({
          pl,
          img,
          meta: { name: r.id, bytes: r.bytes, w: r.width, h: r.height },
          design: { ...d, copyOn: false },
          logo: null,
          fit: "cover",
          padColor: "#07080E",
          ver,
        }).score,
      }));
      const sorted = [...scores].sort((a, b) => a.score - b.score);
      const nums = scores.map(x => x.score).sort((a, b) => a - b);
      setVerdicts(prev => ({
        ...prev,
        [r.id]: {
          median: nums[Math.floor(nums.length / 2)],
          worst: sorted[0].score,
          worstName: sorted[0].pl.plat + " " + sorted[0].pl.name,
          clears: scores.filter(x => x.score >= 65).length,
        },
      }));
    }
  }

  function use(r: GenResult) {
    st.loadCreative(r.dataUrl, `${typeId}-${shape.id}-${r.width}x${r.height}.png`, r.bytes);
    onClose();
  }

  async function writeCopy() {
    setCopyErr(null);
    setCopyBusy(true);
    setVariants([]);
    try {
      const res = await fetch("/api/copy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          brief: copyBrief || brief,
          lang: copyLang,
          market,
          brandName: st.kit.brand,
          source: d.head && copyLang !== d.lang ? `${d.head} / ${d.cta}` : undefined,
          count: 4,
          headlineMax: Number(st.placement.spec["Headline"]?.match(/\d+/)?.[0]) || undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Copy generation failed.");
      setVariants(j.variants ?? []);
    } catch (e) {
      setCopyErr(e instanceof Error ? e.message : "Copy generation failed.");
    } finally {
      setCopyBusy(false);
    }
  }

  function applyVariant(v: CopyVariant) {
    st.setLang(copyLang);
    st.patchDesign({ head: v.headline, cta: v.cta || d.cta });
    st.say("Copy applied — check it clears the safe box");
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Generate"
      sub="Make the picture, write the words, then judge both against every placement."
      foot={
        <>
          <button className="btn" onClick={onClose} type="button">
            Close
          </button>
          {tab === "picture" ? (
            <button className="btn primary" onClick={generate} disabled={busy} type="button">
              {busy ? "Generating…" : `Generate ${count > 1 ? `${count} images` : "image"}`}
            </button>
          ) : (
            <button className="btn primary" onClick={writeCopy} disabled={copyBusy} type="button">
              {copyBusy ? "Writing…" : "Write 4 variants"}
            </button>
          )}
        </>
      }
    >
      <div className="seg" style={{ alignSelf: "flex-start" }}>
        <button aria-pressed={tab === "picture"} onClick={() => setTab("picture")} type="button">
          Picture
        </button>
        <button aria-pressed={tab === "words"} onClick={() => setTab("words")} type="button">
          Words
        </button>
      </div>

      {tab === "picture" ? (
        <>
          <Field label="What are we making">
            <div className="type-grid">
              {CREATIVE_TYPES.map(t => (
                <button
                  key={t.id}
                  className="type-card"
                  aria-pressed={t.id === typeId}
                  onClick={() => setTypeId(t.id)}
                  type="button"
                >
                  <b>{t.label}</b>
                  <span>{t.blurb}</span>
                </button>
              ))}
            </div>
          </Field>

          <Field label="Brief" hint={`${brief.length} ch`}>
            <textarea
              value={brief}
              placeholder={
                typeId === "ugc"
                  ? "A young Saudi woman filming herself next to her clean white sedan in a Riyadh driveway, holding her phone up, smiling"
                  : "A silver 2022 sedan on a seamless deep navy background, three-quarter front angle, one hard highlight down the flank"
              }
              onChange={e => setBrief(e.target.value)}
            />
            <p className="hint">{type.direction.split(".")[0]}.</p>
          </Field>

          <div className="kit-grid">
            <Field label="Target shape" hint={shape.size.replace("x", " × ")}>
              <select value={shapeId} onChange={e => setShapeId(e.target.value)}>
                {SHAPES.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.label} — {s.feeds}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Market">
              <select value={market} onChange={e => setMarket(e.target.value)}>
                {MARKETS.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Variations">
              <select value={count} onChange={e => setCount(Number(e.target.value))}>
                <option value={1}>1 image</option>
                <option value={2}>2 images</option>
                <option value={3}>3 images</option>
                <option value={4}>4 images</option>
              </select>
            </Field>
            <Field label="Quality">
              <select value={quality} onChange={e => setQuality(e.target.value as "low" | "medium" | "high")}>
                <option value="high">High — final asset</option>
                <option value="medium">Medium</option>
                <option value="low">Low — cheap exploration</option>
              </select>
            </Field>
          </div>

          <div className="row">
            <MiniBtn on={universal} onClick={() => setUniversal(v => !v)}>
              Works on every channel
            </MiniBtn>
            <MiniBtn on={includeText} onClick={() => setIncludeText(v => !v)}>
              Render text into the image
            </MiniBtn>
            <MiniBtn on={useReference} onClick={() => setUseReference(v => !v)}>
              Use loaded creative as reference
            </MiniBtn>
          </div>

          {includeText ? (
            <div className="warnbox">
              <b>Baked-in text cannot be moved, translated or safe-zone checked.</b> It will be rendered once, at one
              size, in one language, and every placement inherits it. Leave this off unless you specifically want the
              model to letter the image — the studio&apos;s own layers do the job better.
            </div>
          ) : (
            <p className="hint">
              Generating <b>without text</b>. The model composes the picture; your headline, CTA and logo stay editable
              layers.{" "}
              {universal ? (
                <>
                  <b>Works on every channel</b> is on: the whole message is forced into the centre square, and the
                  bottom <b>{Math.round(zone.bottom * 100)}%</b>, top <b>{Math.round(zone.top * 100)}%</b> and right{" "}
                  <b>{Math.round(zone.right * 100)}%</b> are kept simple — the worst case across all{" "}
                  {PLACEMENTS.length} placements ({zone.worst}). One credit, every placement.
                </>
              ) : (
                <>
                  Constrained to the <b>{shape.label.toLowerCase()}</b> group only — bottom{" "}
                  <b>{Math.round(zone.bottom * 100)}%</b>, top <b>{Math.round(zone.top * 100)}%</b>. Sharper art
                  direction, but you will need a separate generation for other ratios.
                </>
              )}
            </p>
          )}

          {err ? <div className="err">{err}</div> : null}

          {busy ? (
            <div className="busy">
              <Spinner /> gpt-image is rendering at {shape.size.replace("x", " × ")}. High quality takes 20–60 seconds
              per image.
            </div>
          ) : null}

          {results.length ? (
            <div className="gen-grid">
              {results.map(r => (
                <div className="gen-result" key={r.id}>
                  <div className="frame">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.dataUrl} alt="Generated creative" />
                  </div>
                  <div className="ex-name">
                    {r.width} × {r.height}
                    {r.savedToLibrary ? " · saved to library" : " · not saved"}
                  </div>
                  {verdicts[r.id] ? (
                    <div
                      className={
                        "verdict " +
                        (verdicts[r.id].clears >= 18 ? "good" : verdicts[r.id].clears >= 10 ? "mixed" : "poor")
                      }
                    >
                      <b>
                        Clears {verdicts[r.id].clears} of {PLACEMENTS.length} placements
                      </b>
                      <span>
                        median {verdicts[r.id].median} · worst {verdicts[r.id].worst} on {verdicts[r.id].worstName}
                      </span>
                    </div>
                  ) : (
                    <div className="verdict">
                      <span>scoring across {PLACEMENTS.length} placements…</span>
                    </div>
                  )}
                  <button className="btn primary" onClick={() => use(r)} type="button">
                    Use this creative
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {prompt ? (
            <>
              <button className="link-btn" onClick={() => setShowPrompt(v => !v)} type="button">
                {showPrompt ? "Hide" : "Show"} the prompt that produced this
              </button>
              {showPrompt ? <div className="prompt-peek">{prompt}</div> : null}
            </>
          ) : null}

          {library.length ? (
            <Field label="Earlier generations" hint={`${library.length} saved`}>
              <div className="lib-strip">
                {library.map(e => (
                  <button
                    key={e.id}
                    className="lib-item"
                    title={e.brief}
                    type="button"
                    onClick={() => {
                      st.loadCreative(`/api/library?id=${e.id}`, `${e.id}.png`, 0);
                      onClose();
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/library?id=${e.id}`} alt={e.brief} />
                  </button>
                ))}
              </div>
              <p className="hint">Saved to <code>.data/generated</code> — gitignored, local to this machine.</p>
            </Field>
          ) : null}
        </>
      ) : (
        <>
          <Field label="Brief for the copywriter">
            <textarea
              value={copyBrief}
              placeholder="Sellers who are worried about being lowballed. The promise is a free inspection and no haggling."
              onChange={e => setCopyBrief(e.target.value)}
            />
          </Field>

          <div className="kit-grid">
            <Field label="Register">
              <select value={copyLang} onChange={e => setCopyLang(e.target.value as Lang)}>
                <option value="en">English</option>
                <option value="najdi">Arabic — Najdi (KSA)</option>
                <option value="gulf">Arabic — Gulf (UAE)</option>
                <option value="msa">Arabic — MSA</option>
              </select>
            </Field>
            <Field label="Market">
              <select value={market} onChange={e => setMarket(e.target.value)}>
                {MARKETS.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {isRTL(copyLang) ? (
            <div className="warnbox">
              <b>Arabic output is a draft.</b> It is written to register — Najdi for KSA, Khaleeji for the UAE — not
              machine-translated, but the brand book requires a native speaker to sign it off before it runs.
            </div>
          ) : null}

          {copyErr ? <div className="err">{copyErr}</div> : null}
          {copyBusy ? (
            <div className="busy">
              <Spinner /> Claude is writing to {copyLang === "najdi" ? "Najdi" : copyLang === "gulf" ? "Khaleeji" : copyLang.toUpperCase()} register…
            </div>
          ) : null}

          {variants.length ? (
            <div className="gen-grid">
              {variants.map((v, i) => (
                <button
                  key={i}
                  className="variant"
                  dir={isRTL(copyLang) ? "rtl" : undefined}
                  onClick={() => applyVariant(v)}
                  type="button"
                >
                  <span className="vh">{v.headline}</span>
                  <span className="vc">{v.cta}</span>
                  {v.note ? <span className="vn">{v.note}</span> : null}
                </button>
              ))}
            </div>
          ) : null}
          {variants.length ? <p className="hint">Click a variant to drop it into the creative.</p> : null}
        </>
      )}
    </Sheet>
  );
}
