"use client";

/**
 * Everything the Generate tab has ever produced, with the brief and the exact
 * prompt that made it. Reloading one puts it straight back on the stage.
 */

import { useCallback, useEffect, useState } from "react";
import { CREATIVE_TYPES, SHAPES } from "@/lib/core";
import { prettyBytes } from "@/lib/render";
import { useStudio } from "./StudioProvider";
import { Sheet, Spinner } from "./ui";

interface LibEntry {
  id: string;
  createdAt: string;
  typeId: string;
  shapeId: string;
  market: string;
  brief: string;
  prompt: string;
  width: number;
  height: number;
  bytes: number;
  url: string;
}

export function LibrarySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const st = useStudio();
  const [entries, setEntries] = useState<LibEntry[]>([]);
  const [driver, setDriver] = useState<string>("fs");
  const [busy, setBusy] = useState(false);
  const [openPrompt, setOpenPrompt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/library", { cache: "no-store" });
      const j = await res.json();
      setEntries(j.entries ?? []);
      setDriver(j.driver ?? "fs");
    } catch {
      setEntries([]);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function use(e: LibEntry) {
    st.loadCreative(e.url, `${e.id}.png`, e.bytes ?? 0);
    onClose();
  }

  async function remove(e: LibEntry) {
    const res = await fetch(`/api/library?id=${encodeURIComponent(e.id)}`, { method: "DELETE" });
    if (res.ok) {
      setEntries(prev => prev.filter(x => x.id !== e.id));
      st.say("Deleted");
    } else {
      st.say("Could not delete that one");
    }
  }

  const label = (e: LibEntry) => {
    const t = CREATIVE_TYPES.find(x => x.id === e.typeId)?.label ?? e.typeId;
    const s = SHAPES.find(x => x.id === e.shapeId)?.label ?? e.shapeId;
    return `${t} · ${s}`;
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Library"
      sub="Every generated creative, with the brief and prompt that produced it."
      foot={
        <>
          <button className="btn" onClick={onClose} type="button">
            Close
          </button>
          <button className="btn" onClick={load} disabled={busy} type="button">
            Refresh
          </button>
        </>
      }
    >
      {busy && !entries.length ? (
        <div className="busy">
          <Spinner /> Reading the library…
        </div>
      ) : null}

      {!busy && !entries.length ? (
        <div className="notice">
          Nothing here yet. Anything you make in <b>Generate → Picture</b> is saved automatically, with its prompt, and
          shows up here.
        </div>
      ) : null}

      {entries.length ? (
        <>
          <p className="hint">
            {entries.length} {entries.length === 1 ? "creative" : "creatives"} · stored in{" "}
            <b>{driver === "blob" ? "Vercel Blob" : ".data/generated on this machine"}</b>
          </p>
          <div className="export-grid">
            {entries.map(e => (
              <div className="ex-card" key={e.id}>
                <div className="thumb">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={e.url} alt={e.brief} />
                </div>
                <div>
                  <div className="glab-p">{label(e)}</div>
                  <div className="glab-n lib-brief">{e.brief}</div>
                </div>
                <div className="ex-meta">
                  <span>
                    {e.width} × {e.height}
                  </span>
                  <span className="ok">{prettyBytes(e.bytes || 0)}</span>
                  <span>{new Date(e.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="row">
                  <button className="btn primary" onClick={() => use(e)} type="button">
                    Use
                  </button>
                  <button
                    className="btn"
                    onClick={() => setOpenPrompt(openPrompt === e.id ? null : e.id)}
                    type="button"
                  >
                    Prompt
                  </button>
                </div>
                {openPrompt === e.id ? <div className="prompt-peek">{e.prompt}</div> : null}
                <button className="link-btn danger" onClick={() => remove(e)} type="button">
                  Delete
                </button>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {driver === "fs" ? (
        <p className="hint">
          On a serverless host the filesystem is read-only, so deployments need Vercel Blob — add it to the project
          and <code>BLOB_READ_WRITE_TOKEN</code> appears automatically, and this switches over with no code change.
        </p>
      ) : null}
    </Sheet>
  );
}
