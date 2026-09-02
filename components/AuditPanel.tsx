"use client";

import { PLACEMENTS } from "@/lib/core";
import { RATIO_LABEL, fitFor, masterZone } from "@/lib/geometry";
import { PASS_MARK, audit, grade, type Level } from "@/lib/audit";
import { useStudio } from "./StudioProvider";
import { Collapsible } from "./ui";

/**
 * The published cost of every check, so the score can be argued with. Kept in
 * step with lib/audit.ts by hand — there are ten of them and they change
 * rarely, which is cheaper than making the audit self-describing.
 */
const SCORE_TABLE: { what: string; cost: string }[] = [
  { what: "Artwork in a reserved band", cost: "up to -30" },
  { what: "File over the platform ceiling", cost: "-12" },
  { what: "Layer outside the safe box", cost: "-8 each" },
  { what: "Heavy crop from the wrong ratio", cost: "-8" },
  { what: "Below the platform's pixel spec", cost: "-6" },
  { what: "Focal point inside a reserved band", cost: "-6" },
  { what: "Type under 4.5:1 on its background", cost: "-4 each" },
  { what: "Type too small to read on a phone", cost: "-4 each" },
  { what: "Resolution borderline", cost: "-5" },
  { what: "Letterbox bars on a full-bleed slot", cost: "-4" },
];

const pc = (n: number) => `${(n * 100).toFixed(1)}%`;
const icoFor = (l: Level) => (l === "ok" ? "i-check" : l === "warn" ? "i-warn" : "i-x");

export function AuditPanel() {
  const st = useStudio();
  const pl = st.placement;
  const ready = Boolean(st.img && st.meta);

  const a = ready
    ? audit({
        pl,
        img: st.img!,
        meta: st.meta!,
        design: st.design,
        logo: st.logo,
        fit: fitFor(st.design, pl.id),
        padColor: st.padColor,
        ver: st.ver,
      })
    : null;

  const g = a ? grade(a.score) : null;
  const z = masterZone(pl, PLACEMENTS);
  const fails = a ? a.checks.filter(c => c.level !== "ok").length : 0;

  return (
    <aside className="col col-right">
      <div className="panel">
        <div className="p-head">
          <span className="p-title">Placement readiness</span>
        </div>
        <div className="score-wrap">
          <div className="score-num" style={{ color: g?.color }}>
            {a ? a.score : "—"}
          </div>
          <div className="score-meta">
            <div className="score-grade" style={{ color: g?.color }}>
              {g ? g.label : "Load a creative"}
            </div>
            <div className="score-for">{ready ? `${pl.plat} · ${pl.name}` : "No placement scored yet"}</div>
            <div className="meter">
              <i style={{ width: `${a ? a.score : 0}%`, background: g?.color }} />
              {/* the bar marketing gates on, drawn where it actually falls */}
              <span className="meter-mark" style={{ left: `${PASS_MARK}%` }} aria-hidden="true" />
            </div>
            <div className="score-bar-note">
              Share at <b>{PASS_MARK}</b> or above
            </div>
          </div>
        </div>
      </div>

      {a ? (
        <>
          <div className="panel">
            <div className="p-head">
              <span className="p-title">Checks</span>
              <span className="p-note">{fails ? `${fails} to look at` : "all clear"}</span>
            </div>
            <ul className="checks">
              {a.checks.map((c, i) => (
                <li className="check" key={`${c.title}-${i}`}>
                  <span className={`chk-ico ${c.level}`}>
                    <svg>
                      <use href={`#${icoFor(c.level)}`} />
                    </svg>
                  </span>
                  <span className="chk-body">
                    <span className="chk-t">
                      {c.title}
                      <em>{c.tag}</em>
                      {c.penalty > 0 ? <b className="chk-cost">-{c.penalty}</b> : null}
                    </span>
                    <span className="chk-d" dangerouslySetInnerHTML={{ __html: c.detail }} />
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="panel">
            <Collapsible
              title="Master safe zone"
              hint={`${z.safeW} × ${z.safeH}`}
            >
            <div className="p-head">
              <span className="p-title">Master safe zone</span>
              <span className="p-note">
                {RATIO_LABEL(pl.w / pl.h)} · {z.group.length} {z.group.length === 1 ? "placement" : "placements"}
              </span>
            </div>
            <div className="master-box">
              <div className="master-vis">
                <div className="mband" style={{ top: 0, left: 0, right: 0, height: pc(z.t) }} />
                <div className="mband" style={{ bottom: 0, left: 0, right: 0, height: pc(z.b) }} />
                <div className="mband" style={{ top: pc(z.t), bottom: pc(z.b), left: 0, width: pc(z.l) }} />
                <div className="mband" style={{ top: pc(z.t), bottom: pc(z.b), right: 0, width: pc(z.r) }} />
                <div className="mrect" style={{ top: pc(z.t), bottom: pc(z.b), left: pc(z.l), right: pc(z.r) }} />
                <div className="mlab">
                  {z.safeW} × {z.safeH}
                </div>
              </div>
              <div className="master-row">
                <span>Clear from top</span>
                <b>
                  {Math.round(z.t * pl.h)}px ({Math.round(z.t * 100)}%)
                </b>
              </div>
              <div className="master-row">
                <span>Clear from bottom</span>
                <b>
                  {Math.round(z.b * pl.h)}px ({Math.round(z.b * 100)}%)
                </b>
              </div>
              <div className="master-row">
                <span>Clear from sides</span>
                <b>{Math.round(Math.max(z.l, z.r) * pl.w)}px</b>
              </div>
              <p className="master-note">
                One layout that clears every {RATIO_LABEL(pl.w / pl.h)} placement lives inside{" "}
                <b style={{ color: "var(--lime)" }}>
                  {z.safeW} × {z.safeH}
                </b>
                . {z.deepest.plat} {z.deepest.name} sets the floor with {z.deepest.safe.b}px of bottom furniture.
              </p>
            </div>
            </Collapsible>
          </div>

          <div className="panel">
            <Collapsible title="How this score works" hint={`starts at 100`}>
              <p className="hint" style={{ marginTop: 0 }}>
                Every placement starts at <b>100</b> and each failed check takes points off. The number next to a
                check is what it cost. Nothing else moves the score, so two people auditing the same creative get
                the same number.
              </p>
              <table className="spec-table">
                <tbody>
                  {SCORE_TABLE.map(r => (
                    <tr key={r.what}>
                      <th>{r.what}</th>
                      <td>{r.cost}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="hint">
                <b>Safe zone</b> — the part of the frame the platform covers with its own furniture: username,
                caption, action rail, the swipe-up. Anything you put there can be hidden, so the reserved bands are
                drawn as hatching on the frame. Turn them off with <b>Safe zones</b> in the top bar.
              </p>
              <p className="hint">
                <b>Collision</b> — a measure of your <i>artwork</i>, not your layers. The picture is scored for local
                detail, and the red flag map marks places where busy detail falls inside a reserved band: a face, a
                number plate, the edge of a car. A flat sky under the caption is not a collision; a licence plate
                under it is. It says nothing about whether your headline overlaps the safe zone — that is the
                per-layer checks above.
              </p>
              <p className="hint">
                Both are measured against <b>this</b> placement&apos;s frame after the crop, which is why the same
                artwork scores differently on a 9:16 story and a 16:9 pre-roll.
              </p>
            </Collapsible>
          </div>

          <div className="panel">
            <Collapsible title="Spec sheet" hint={`${pl.w} × ${pl.h}`}>
              <table className="spec-table">
                <tbody>
                  {Object.entries(pl.spec).map(([k, v]) => (
                    <tr key={k}>
                      <th>{k}</th>
                      <td>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Collapsible>
          </div>

          <div className="panel">
            <Collapsible title="Best practice" hint={`${pl.bp.length} notes`}>
              <ul className="bp">
                {pl.bp.map(t => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </Collapsible>
          </div>
        </>
      ) : null}

      <p className="phase-note">
        <b>Where these numbers come from.</b> Reserved bands are the published ad-spec safe areas for each placement,
        expressed against that placement&apos;s own canvas, and they live in <code>lib/core.ts</code>. Platforms revise
        their UI without notice — re-check the spec sheet against the ad manager before a launch you cannot redo.
      </p>
    </aside>
  );
}
