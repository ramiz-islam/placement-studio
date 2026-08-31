"use client";

/**
 * Platform chrome mocks. Everything is sized in cqw against the device
 * container, so one template scales from a 150px grid card to a 440px stage.
 */

import type { Placement } from "@/lib/core";

const Ico = ({ id, solid, style }: { id: string; solid?: boolean; style?: React.CSSProperties }) => (
  <svg className={`ch-ico${solid ? " solid" : ""}`} style={style}>
    <use href={`#${id}`} />
  </svg>
);

const Av = ({ size = "7.6cqw", radius = "50%" }: { size?: string; radius?: string }) => (
  <div className="ch-av" style={{ width: size, height: size, borderRadius: radius }} />
);

const RailIco = ({ id, n }: { id: string; n?: string }) => (
  <div className="ch-rail-item">
    <svg>
      <use href={`#${id}`} />
    </svg>
    {n ? <span>{n}</span> : null}
  </div>
);

export interface ChromeProps {
  pl: Placement;
  brand: string;
  cta: string;
  caption: string;
}

export function Chrome({ pl, brand, cta, caption }: ChromeProps) {
  const handle = "@" + brand.toLowerCase().replace(/\s+/g, "");

  switch (pl.chrome) {
    case "snap":
      return (
        <div className="ch">
          <div className="ch-top">
            <Av />
            <div>
              <div className="ch-name">{brand}</div>
              <div className="ch-spon">Sponsored</div>
            </div>
            <div style={{ flex: 1 }} />
            <Ico id="i-dots" />
          </div>
          <div className="ch-sendbar">
            <div className="pill">Send a Chat</div>
            <Ico id="i-cam" />
            <Ico id="i-send" solid />
          </div>
          <div className="ch-bottom" style={{ bottom: "11cqw", alignItems: "center" }}>
            <div className="ch-cta" style={{ width: "46%", background: "#fff", color: "#141652", border: "none" }}>
              {cta}
            </div>
          </div>
        </div>
      );

    case "tiktok":
      return (
        <div className="ch">
          <div className="ch-tabs">
            <span className="off">Following</span>
            <span className="on">For You</span>
          </div>
          <div className="ch-rail">
            <div className="ch-rail-item">
              <Av size="8.4cqw" />
            </div>
            <RailIco id="i-heart" n="12.4K" />
            <RailIco id="i-comment" n="398" />
            <RailIco id="i-book" n="1.2K" />
            <RailIco id="i-share" />
            <div className="ch-disc" />
          </div>
          <div className="ch-bottom">
            <div className="ch-handle">{handle}</div>
            <div className="ch-caption">{caption}</div>
            <div className="ch-music">
              <svg>
                <use href="#i-note" />
              </svg>
              <span>original sound · {brand}</span>
            </div>
            <div className="ch-cta">{cta} →</div>
            <div className="ch-progress" style={{ position: "relative", left: 0, right: 0, marginTop: "1.6cqw" }}>
              <i />
            </div>
          </div>
        </div>
      );

    case "reels":
      return (
        <div className="ch">
          <div className="ch-top">
            <div className="ch-name" style={{ fontSize: "4cqw" }}>
              Reels
            </div>
            <div style={{ flex: 1 }} />
            <Ico id="i-cam" />
          </div>
          <div className="ch-rail">
            <RailIco id="i-heart" n="8,214" />
            <RailIco id="i-comment" n="167" />
            <RailIco id="i-share" />
            <RailIco id="i-dots" />
          </div>
          <div className="ch-bottom">
            <div className="ch-cta">{cta} →</div>
            <div style={{ display: "flex", alignItems: "center", gap: "2cqw", marginTop: "1cqw" }}>
              <Av size="6.4cqw" />
              <span className="ch-handle">{brand}</span>
              <span
                style={{
                  border: ".35cqw solid rgba(255,255,255,.7)",
                  borderRadius: "1cqw",
                  padding: ".5cqw 2cqw",
                  fontSize: "2.5cqw",
                }}
              >
                Follow
              </span>
            </div>
            <div className="ch-caption">{caption}</div>
            <div className="ch-music">
              <svg>
                <use href="#i-note" />
              </svg>
              <span>{brand} · Original audio</span>
            </div>
          </div>
        </div>
      );

    case "stories":
      return (
        <div className="ch">
          <div className="ch-progress" style={{ top: "3cqw" }}>
            <i />
          </div>
          <div className="ch-top" style={{ paddingTop: "6cqw" }}>
            <Av />
            <div>
              <div className="ch-name">{brand}</div>
              <div className="ch-spon">Sponsored</div>
            </div>
            <div style={{ flex: 1 }} />
            <Ico id="i-dots" />
          </div>
          <div className="ch-bottom" style={{ alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: ".8cqw" }}>
              <Ico id="i-share" style={{ transform: "rotate(-90deg)" }} />
              <span style={{ fontSize: "3cqw", fontWeight: 700 }}>{cta}</span>
            </div>
          </div>
        </div>
      );

    case "shorts":
      return (
        <div className="ch">
          <div className="ch-top">
            <div style={{ flex: 1 }} />
            <Ico id="i-cam" />
            <Ico id="i-dots" />
          </div>
          <div className="ch-rail">
            <RailIco id="i-heart" n="24K" />
            <RailIco id="i-comment" n="512" />
            <RailIco id="i-share" />
            <RailIco id="i-dots" />
          </div>
          <div className="ch-bottom">
            <div style={{ display: "flex", alignItems: "center", gap: "2cqw" }}>
              <Av size="6.4cqw" />
              <span className="ch-handle">{brand}</span>
              <span
                style={{
                  background: "#fff",
                  color: "#141652",
                  borderRadius: "1cqw",
                  padding: ".6cqw 2.4cqw",
                  fontSize: "2.6cqw",
                  fontWeight: 800,
                  textShadow: "none",
                }}
              >
                Subscribe
              </span>
            </div>
            <div className="ch-caption">{caption}</div>
            <div className="ch-cta">{cta} →</div>
          </div>
        </div>
      );

    case "igfeed":
      return (
        <div className="ch">
          <div className="ch-top" style={{ background: "#000", padding: "2.6cqw 3cqw" }}>
            <Av size="6.6cqw" />
            <div>
              <div className="ch-name">{brand}</div>
              <div className="ch-spon">Sponsored</div>
            </div>
            <div style={{ flex: 1 }} />
            <Ico id="i-dots" />
          </div>
          <div className="ch-bottom" style={{ background: "#000", padding: "2.4cqw 3cqw 2.6cqw", gap: "1.4cqw" }}>
            <div style={{ display: "flex", gap: "3.4cqw", alignItems: "center" }}>
              <Ico id="i-heart" />
              <Ico id="i-comment" />
              <Ico id="i-share" />
              <div style={{ flex: 1 }} />
              <Ico id="i-book" />
            </div>
            <div className="ch-caption" style={{ maxWidth: "100%" }}>
              <b>{brand}</b> {caption}
            </div>
            <div style={{ fontSize: "2.6cqw", opacity: 0.6 }}>{cta}</div>
          </div>
        </div>
      );

    case "fbfeed":
      return (
        <div className="ch">
          <div className="ch-strip top" style={{ background: "#18191A" }}>
            <Av size="7cqw" />
            <div>
              <div className="ch-name">{brand}</div>
              <div className="ch-spon">Sponsored</div>
            </div>
            <div style={{ flex: 1 }} />
            <Ico id="i-dots" />
          </div>
          <div className="ch-strip bot" style={{ background: "#242526" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "2.6cqw" }}>
              <div style={{ flex: 1 }}>
                <div className="dom">carswitch app</div>
                <div className="ttl">{caption}</div>
              </div>
              <div className="btn2" style={{ background: "#3A3B3C" }}>
                {cta}
              </div>
            </div>
          </div>
        </div>
      );

    case "google":
      return (
        <div className="ch">
          <div className="ch-strip bot" style={{ background: "#1F1F1F" }}>
            <div style={{ fontSize: "2.5cqw", fontWeight: 800, color: "#8AB4F8" }}>Ad · {brand}</div>
            <div className="ttl">{caption}</div>
            <div className="desc">Free inspection, we handle the paperwork. Get a price in the app.</div>
            <div
              className="btn2"
              style={{ border: ".35cqw solid #8AB4F8", color: "#8AB4F8", background: "none", borderRadius: "999px" }}
            >
              {cta}
            </div>
          </div>
        </div>
      );

    case "appcamp":
      return (
        <div className="ch">
          <div className="ch-instbar">
            <div className="ch-appicon" />
            <div>
              <div className="ch-name">{brand}</div>
              <div className="ch-spon">Free · In-app purchases</div>
            </div>
            <div className="btn2">Install</div>
          </div>
        </div>
      );

    case "pinterest":
      return (
        <div className="ch">
          <div className="ch-savebtn">Save</div>
          <div
            className="ch-strip bot"
            style={{ background: "linear-gradient(transparent,rgba(0,0,0,.82) 45%)" }}
          >
            <div className="ttl">{caption}</div>
            <div style={{ display: "flex", alignItems: "center", gap: "2cqw", marginTop: ".6cqw" }}>
              <Av size="5.6cqw" />
              <span style={{ fontSize: "2.7cqw", opacity: 0.85 }}>{brand}</span>
            </div>
          </div>
        </div>
      );

    case "xpost":
      return (
        <div className="ch">
          <div className="ch-strip top" style={{ background: "#000" }}>
            <Av size="6.4cqw" />
            <div>
              <div className="ch-name">
                {brand} <span style={{ opacity: 0.55, fontWeight: 400 }}>{handle}</span>
              </div>
              <div className="ch-spon">Promoted</div>
            </div>
          </div>
          <div
            className="ch-strip bot"
            style={{
              background: "#000",
              flexDirection: "row",
              alignItems: "center",
              gap: "6cqw",
              justifyContent: "space-around",
              opacity: 0.7,
            }}
          >
            <Ico id="i-comment" />
            <Ico id="i-repeat" />
            <Ico id="i-heart" />
            <Ico id="i-share" />
          </div>
        </div>
      );

    case "lipost":
      return (
        <div className="ch">
          <div className="ch-strip top" style={{ background: "#1B1F23" }}>
            <Av size="7cqw" radius="1.4cqw" />
            <div>
              <div className="ch-name">{brand}</div>
              <div className="ch-spon">Promoted · 12,480 followers</div>
            </div>
          </div>
          <div className="ch-strip bot" style={{ background: "#1B1F23" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "2.6cqw" }}>
              <div style={{ flex: 1 }}>
                <div className="ttl" style={{ fontSize: "2.9cqw" }}>
                  {caption}
                </div>
                <div className="dom">carswitch app</div>
              </div>
              <div
                className="btn2"
                style={{ border: ".35cqw solid #70B5F9", color: "#70B5F9", background: "none", borderRadius: "1cqw" }}
              >
                {cta}
              </div>
            </div>
          </div>
        </div>
      );

    default:
      return null;
  }
}
