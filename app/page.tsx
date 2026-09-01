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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSheet(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
            <div className="mark-sub">CarSwitch</div>
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

        <div className="bar-spacer" />

        <Toggle variant="safe" on={st.zones} onClick={() => st.patch({ zones: !st.zones })}>
          Safe zones
        </Toggle>
        <Toggle variant="flag" on={st.flags} onClick={() => st.patch({ flags: !st.flags })}>
          Collisions
        </Toggle>
        <Toggle on={st.chrome} onClick={() => st.patch({ chrome: !st.chrome })}>
          Platform UI
        </Toggle>

        <button className="btn lime" onClick={() => setSheet("gen")} type="button">
          Generate
        </button>
        <button className="btn" onClick={() => setSheet("lib")} type="button">
          Library
        </button>
        <button className="btn" onClick={() => setSheet("kit")} type="button">
          Brand kit
        </button>
        <button className="btn primary" onClick={() => setSheet("export")} disabled={!st.img} type="button">
          Export
        </button>
        <button className="btn" onClick={st.reset} type="button">
          Reset
        </button>
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
