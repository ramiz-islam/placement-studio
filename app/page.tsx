"use client";

import { useEffect, useState } from "react";
import { StudioProvider, useStudio } from "@/components/StudioProvider";
import { Icons, Toggle } from "@/components/ui";
import { LeftRail } from "@/components/LeftRail";
import { Stage } from "@/components/Stage";
import { AuditPanel } from "@/components/AuditPanel";
import { ExportSheet } from "@/components/ExportSheet";
import { BrandKitSheet } from "@/components/BrandKitSheet";
import { GenerateSheet } from "@/components/GenerateSheet";
import { LibrarySheet } from "@/components/LibrarySheet";
import { KIT_KEY } from "@/lib/core";

export default function Page() {
  return (
    <StudioProvider>
      <Icons />
      <Studio />
    </StudioProvider>
  );
}

function Studio() {
  const st = useStudio();
  const [sheet, setSheet] = useState<null | "export" | "kit" | "gen" | "lib">(null);
  const [firstRun, setFirstRun] = useState(false);
  const [menu, setMenu] = useState<null | "view" | "more">(null);
  const shownCount = [st.zones, st.flags, st.chrome, st.deviceFrame].filter(Boolean).length;

  // Ask for the brand kit once, then never again.
  useEffect(() => {
    if (!st.kitReady) return;
    let saved = false;
    try {
      saved = Boolean(localStorage.getItem(KIT_KEY));
    } catch {
      saved = true; // storage blocked — do not nag on every load
    }
    if (!saved) {
      setFirstRun(true);
      setSheet("kit");
    }
  }, [st.kitReady]);

  // any click outside a menu closes it
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest(".menu-wrap")) setMenu(null);
    };
    window.addEventListener("click", away);
    return () => window.removeEventListener("click", away);
  }, [menu]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const inField = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      if (e.key === "Escape") {
        setSheet(null);
        setMenu(null);
        st.select(null);
      }
      // arrow keys nudge the selection: the dependable way to move a layer that
      // is sitting underneath another
      if (!inField && st.selectedIds.length && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 40 : 4;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        st.nudge(dx, dy);
        return;
      }
      const meta = e.ctrlKey || e.metaKey;
      if (!meta) return;
      const k = e.key.toLowerCase();
      // never steal the shortcut from a field the user is typing in
      const typing = inField;
      if (k === "z" && !e.shiftKey && !typing) {
        e.preventDefault();
        st.undo();
      } else if ((k === "z" && e.shiftKey) || k === "y") {
        if (typing) return;
        e.preventDefault();
        st.redo();
      } else if ((e.key === "]" || e.key === "[") && st.selectedId && !typing) {
        e.preventDefault();
        if (e.shiftKey) {
          if (e.key === "]") st.toFront(st.selectedId);
          else st.toBack(st.selectedId);
        } else {
          st.reorderLayer(st.selectedId, e.key === "]" ? 1 : -1);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [st]);

  // Drag a file anywhere onto the window.
  useEffect(() => {
    const stop = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (!f || !f.type.startsWith("image/")) return;
      const fr = new FileReader();
      fr.onload = ev => st.loadCreative(String(ev.target?.result), f.name, f.size);
      fr.readAsDataURL(f);
    };
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", drop);
    };
  }, [st]);

  return (
    <>
      <header className="app-bar">
        <div className="mark">
          <div className="mark-glyph">
            <svg width="16" height="16">
              <use href="#i-switch" />
            </svg>
          </div>
          <div>
            <div className="mark-name">Placement Studio</div>
            <div className="mark-sub" title={`built ${process.env.NEXT_PUBLIC_BUILT_AT ?? ""}`}>
              CarSwitch · {process.env.NEXT_PUBLIC_BUILD ?? "local"}
            </div>
          </div>
        </div>

        <div className="seg" role="group" aria-label="View">
          <button aria-pressed={st.view === "focus"} onClick={() => st.patch({ view: "focus" })} type="button">
            Focus
          </button>
          <button aria-pressed={st.view === "grid"} onClick={() => st.patch({ view: "grid" })} type="button">
            All placements
          </button>
        </div>

        <div className="seg" role="group" aria-label="History">
          <button onClick={st.undo} disabled={!st.canUndo} title="Undo (Ctrl+Z)" type="button">
            ↶ Undo{st.canUndo ? ` ${st.canUndo}` : ""}
          </button>
          <button onClick={st.redo} disabled={!st.canRedo} title="Redo (Ctrl+Shift+Z)" type="button">
            ↷ Redo
          </button>
        </div>

        <div className="bar-spacer" />

        {/* four view toggles collapsed behind one control, with a count so their
            state is still legible at a glance */}
        <div className="menu-wrap">
          <button
            className="btn"
            aria-expanded={menu === "view"}
            onClick={() => setMenu(menu === "view" ? null : "view")}
            type="button"
          >
            Guides {shownCount}/4
          </button>
          {menu === "view" ? (
            <div className="menu">
              <Toggle variant="safe" on={st.zones} onClick={() => st.patch({ zones: !st.zones })}>
                Safe zones
              </Toggle>
              <Toggle variant="flag" on={st.flags} onClick={() => st.patch({ flags: !st.flags })}>
                Collisions
              </Toggle>
              <Toggle on={st.chrome} onClick={() => st.patch({ chrome: !st.chrome })}>
                Platform UI
              </Toggle>
              <Toggle on={st.deviceFrame} onClick={() => st.patch({ deviceFrame: !st.deviceFrame })}>
                Phone shell
              </Toggle>
            </div>
          ) : null}
        </div>

        <button className="btn lime" onClick={() => setSheet("gen")} type="button">
          Generate
        </button>
        <button className="btn" onClick={() => setSheet("lib")} type="button">
          Library
        </button>
        <button className="btn primary" onClick={() => setSheet("export")} disabled={!st.img} type="button">
          Export
        </button>

        <div className="menu-wrap">
          <button
            className="btn"
            aria-expanded={menu === "more"}
            onClick={() => setMenu(menu === "more" ? null : "more")}
            title="More"
            type="button"
          >
            ⋯
          </button>
          {menu === "more" ? (
            <div className="menu">
              <button
                className="btn"
                onClick={() => {
                  setSheet("kit");
                  setMenu(null);
                }}
                type="button"
              >
                Brand kit
              </button>
              <button
                className="btn"
                onClick={() => {
                  st.reset();
                  setMenu(null);
                }}
                type="button"
              >
                Start over
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <main className="shell">
        <LeftRail onGenerate={() => setSheet("gen")} />
        <Stage onGenerate={() => setSheet("gen")} />
        <AuditPanel />
      </main>

      <ExportSheet open={sheet === "export"} onClose={() => setSheet(null)} />
      <BrandKitSheet
        open={sheet === "kit"}
        firstRun={firstRun}
        onClose={() => {
          setSheet(null);
          setFirstRun(false);
        }}
      />
      <GenerateSheet open={sheet === "gen"} onClose={() => setSheet(null)} />
      <LibrarySheet open={sheet === "lib"} onClose={() => setSheet(null)} />

      <div className={`toast${st.toast ? " on" : ""}`}>{st.toast}</div>
    </>
  );
}
