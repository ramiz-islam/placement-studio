"use client";

import { PLACEMENTS } from "@/lib/core";
import { RATIO_LABEL, masterZone } from "@/lib/geometry";
import { audit, grade, type Level } from "@/lib/audit";
import { useStudio } from "./StudioProvider";

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
        fit: st.design.fit,
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
                    </span>
                    <span className="chk-d" dangerouslySetInnerHTML={{ __html: c.detail }} />
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="panel">
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
          </div>

          <div className="panel">
            <div className="p-head">
              <span className="p-title">Spec sheet</span>
            </div>
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
          </div>

          <div className="panel">
            <div className="p-head">
              <span className="p-title">Best practice</span>
            </div>
            <ul className="bp">
              {pl.bp.map(t => (
                <li key={t}>{t}</li>
              ))}
            </ul>
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
