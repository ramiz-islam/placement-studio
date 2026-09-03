"use client";

/**
 * Connect Figma, import a frame.
 *
 * Each person connects their own Figma account, so an import shows them exactly
 * what they can see in Figma — no shared token, no file that "works for Ramiz
 * but not for me". The connection lives in a sealed cookie on this browser.
 */

import { useEffect, useState } from "react";
import { useStudio } from "./StudioProvider";

interface Me {
  configured: boolean;
  connected: boolean;
  expired?: boolean;
  user?: { handle: string; email?: string; img?: string } | null;
}

export function FigmaPanel() {
  const st = useStudio();
  const [me, setMe] = useState<Me | null>(null);
  const [url, setUrl] = useState("");

  const refresh = () =>
    fetch("/api/figma/me")
      .then(r => r.json() as Promise<Me>)
      .then(setMe)
      .catch(() => setMe({ configured: false, connected: false }));

  useEffect(() => {
    void refresh();
    // coming back from Figma: say what happened, then tidy the address bar
    const q = new URLSearchParams(window.location.search);
    const state = q.get("figma");
    if (state) {
      if (state === "connected") st.say("Figma connected");
      else if (state === "denied") st.say("Figma access was declined");
      else st.say(q.get("why") || "Figma did not complete the connection");
      window.history.replaceState(null, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!me) return null;

  // not registered yet: say so only where someone can act on it
  if (!me.configured) {
    return (
      <div className="panel figma">
        <div className="p-head">
          <span className="p-title">Figma</span>
          <span className="p-note">not set up</span>
        </div>
        <p className="hint" style={{ marginTop: 0 }}>
          Register the app at figma.com/developers and add its client id and secret to the deployment. Then anyone can
          connect their own Figma here.
        </p>
      </div>
    );
  }

  if (!me.connected) {
    return (
      <div className="panel figma">
        <div className="p-head">
          <span className="p-title">Figma</span>
        </div>
        <a className="btn figma-connect" href="/api/figma/connect">
          <svg viewBox="0 0 38 57" width="12" height="18" aria-hidden="true">
            <path fill="#1abcfe" d="M19 28.5a9.5 9.5 0 1 1 19 0 9.5 9.5 0 0 1-19 0z" />
            <path fill="#0acf83" d="M0 47.5A9.5 9.5 0 0 1 9.5 38H19v9.5a9.5 9.5 0 1 1-19 0z" />
            <path fill="#ff7262" d="M19 0v19h9.5a9.5 9.5 0 1 0 0-19H19z" />
            <path fill="#f24e1e" d="M0 9.5A9.5 9.5 0 0 0 9.5 19H19V0H9.5A9.5 9.5 0 0 0 0 9.5z" />
            <path fill="#a259ff" d="M0 28.5A9.5 9.5 0 0 0 9.5 38H19V19H9.5A9.5 9.5 0 0 0 0 28.5z" />
          </svg>
          Connect Figma
        </a>
        <p className="hint">
          {me.expired ? "Your previous connection expired. " : ""}
          You approve once; imports then see whatever your own Figma account can open.
        </p>
      </div>
    );
  }

  return (
    <div className="panel figma">
      <div className="p-head">
        <span className="p-title">Figma</span>
        <span className="p-note">
          {me.user?.handle ? `as ${me.user.handle}` : "connected"} ·{" "}
          <button
            className="link-btn"
            type="button"
            onClick={() =>
              fetch("/api/figma/disconnect", { method: "POST" }).then(() => {
                setMe({ configured: true, connected: false });
                st.say("Figma disconnected");
              })
            }
          >
            disconnect
          </button>
        </span>
      </div>
      <form
        className="figma-import"
        onSubmit={e => {
          e.preventDefault();
          if (!url.trim() || st.importing) return;
          void st.importFigma(url.trim()).then(() => setUrl(""));
        }}
      >
        <input
          type="url"
          value={url}
          placeholder="Paste a frame link from Figma"
          onChange={e => setUrl(e.target.value)}
          disabled={st.importing}
        />
        <button className="btn primary" type="submit" disabled={!url.trim() || st.importing}>
          {st.importing ? "Importing…" : "Import"}
        </button>
      </form>
      <p className="hint">
        Select the frame in Figma, Share → Copy link. Its artwork becomes the creative; text, shapes and images arrive as
        layers in the designer&apos;s positions.
      </p>
    </div>
  );
}
