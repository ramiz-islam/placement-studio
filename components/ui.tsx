"use client";

/** Small shared controls. Class names match the ported stylesheet. */

import { BRAND_SWATCHES } from "@/lib/core";

export const Icons = () => (
  <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
    <defs>
      <symbol id="i-switch" viewBox="0 0 24 24">
        <rect x="2.5" y="4" width="19" height="7" rx="3.5" fill="#FF5450" />
        <circle cx="18" cy="7.5" r="2.1" fill="#141652" />
        <rect x="2.5" y="13" width="19" height="7" rx="3.5" fill="#FFFFFF" />
        <circle cx="6" cy="16.5" r="2.1" fill="#141652" />
      </symbol>
      <symbol id="i-up" viewBox="0 0 24 24">
        <path d="M12 16V4m0 0L7 9m5-5 5 5" />
        <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
      </symbol>
      <symbol id="i-check" viewBox="0 0 24 24">
        <path d="M4 12.5 9.5 18 20 6" />
      </symbol>
      <symbol id="i-warn" viewBox="0 0 24 24">
        <path d="M12 5v9M12 18v.5" />
      </symbol>
      <symbol id="i-x" viewBox="0 0 24 24">
        <path d="M6 6l12 12M18 6 6 18" />
      </symbol>
      <symbol id="i-heart" viewBox="0 0 24 24">
        <path d="M12 21s-8-4.9-8-10.4A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 8 3.6C20 16.1 12 21 12 21z" />
      </symbol>
      <symbol id="i-comment" viewBox="0 0 24 24">
        <path d="M21 12a8.5 8.5 0 0 1-12.3 7.6L4 21l1.5-4.3A8.5 8.5 0 1 1 21 12z" />
      </symbol>
      <symbol id="i-share" viewBox="0 0 24 24">
        <path d="M3 11 21 4l-7 17-2.5-7z" />
      </symbol>
      <symbol id="i-book" viewBox="0 0 24 24">
        <path d="M6 3h12v18l-6-4.5L6 21z" />
      </symbol>
      <symbol id="i-note" viewBox="0 0 24 24">
        <path d="M9 18V6l10-2v12" />
        <circle cx="6.5" cy="18" r="2.5" />
        <circle cx="16.5" cy="16" r="2.5" />
      </symbol>
      <symbol id="i-cam" viewBox="0 0 24 24">
        <rect x="3" y="7" width="18" height="13" rx="3" />
        <circle cx="12" cy="13.5" r="3.4" />
        <path d="M9 7l1.4-2.5h3.2L15 7" />
      </symbol>
      <symbol id="i-send" viewBox="0 0 24 24">
        <path d="M3 11 21 4l-7 17-2.5-7z" />
      </symbol>
      <symbol id="i-dots" viewBox="0 0 24 24">
        <circle cx="12" cy="5" r="1.6" />
        <circle cx="12" cy="12" r="1.6" />
        <circle cx="12" cy="19" r="1.6" />
      </symbol>
      <symbol id="i-repeat" viewBox="0 0 24 24">
        <path d="M4 8h11a4 4 0 0 1 0 8H9m0 0 3-3m-3 3 3 3" />
      </symbol>
      <symbol id="i-spark" viewBox="0 0 24 24">
        <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
        <path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
      </symbol>
    </defs>
  </svg>
);

export function Toggle({
  on,
  onClick,
  children,
  variant,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  variant?: "safe" | "flag";
}) {
  return (
    <button
      className={`toggle${variant === "flag" ? " t-flag" : variant === "safe" ? " t-safe" : ""}`}
      aria-pressed={on}
      onClick={onClick}
      type="button"
    >
      <i className="dot" />
      {children}
    </button>
  );
}

export function MiniBtn({
  on,
  onClick,
  children,
}: {
  on?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button className="mini-btn" aria-pressed={on} onClick={onClick} type="button">
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="field">
      <label className="f-label">
        <span>{label}</span>
        {hint ? <b>{hint}</b> : null}
      </label>
      {children}
    </div>
  );
}

const isHex = (v: string) => /^#?[0-9a-fA-F]{6}$/.test(v.trim());
const normHex = (v: string) => "#" + v.trim().replace("#", "").toUpperCase();

export function ColorField({
  label,
  value,
  onChange,
  swatches = true,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  swatches?: boolean;
}) {
  return (
    <div className="field">
      <label className="f-label">
        <span>{label}</span>
        <b>{value}</b>
      </label>
      <div className="swatch-row">
        <span className="swatch">
          <input
            type="color"
            value={value.toLowerCase()}
            onChange={e => onChange(normHex(e.target.value))}
            aria-label={`${label} colour picker`}
          />
        </span>
        <input
          type="text"
          className="hexbox"
          spellCheck={false}
          value={value}
          onChange={e => onChange(e.target.value.toUpperCase())}
          onBlur={e => onChange(isHex(e.target.value) ? normHex(e.target.value) : value)}
          aria-label={`${label} hex code`}
        />
      </div>
      {swatches ? (
        <div className="preset-dots">
          {BRAND_SWATCHES.map(([hex, name]) => (
            <button
              key={hex}
              type="button"
              className="pdot"
              style={{ background: hex }}
              title={`${name} ${hex}`}
              aria-label={name}
              onClick={() => onChange(hex)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Sheet({
  open,
  onClose,
  title,
  sub,
  narrow,
  foot,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  sub?: string;
  narrow?: boolean;
  foot?: React.ReactNode;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="sheet"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className={`sheet-panel${narrow ? " narrow" : ""}`}>
        <div className="sheet-head">
          <div style={{ flex: 1 }}>
            <h2>{title}</h2>
            {sub ? <p>{sub}</p> : null}
          </div>
          <button className="close-x" onClick={onClose} aria-label="Close" type="button">
            <svg>
              <use href="#i-x" />
            </svg>
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {foot ? <div className="sheet-foot">{foot}</div> : null}
      </div>
    </div>
  );
}

export const Spinner = () => <i className="spinner" />;
