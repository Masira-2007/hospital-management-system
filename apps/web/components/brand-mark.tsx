import { useId } from "react";

export function BrandMark({ compact = false, inverse = false }: { compact?: boolean; inverse?: boolean }) {
  const gradientId = `jr-xpert-gradient-${useId().replaceAll(":", "")}`;

  return (
    <span className={`brand-lockup${compact ? " brand-lockup-compact" : ""}${inverse ? " brand-lockup-inverse" : ""}`}>
      <svg
        className="brand-logo-image"
        viewBox="0 0 555 150"
        role="img"
        aria-label="JR Xpert HMS — Hospital Management System. Better Care. Smarter Management. Healthier Tomorrow."
        focusable="false"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#087dbb" />
            <stop offset="1" stopColor="#08aaa6" />
          </linearGradient>
        </defs>
        <path
          fill={`url(#${gradientId})`}
          d="M48 4c-9 0-15 6-15 15v22H14C6 41 2 47 2 55v29c0 9 6 15 15 15h16v24c0 9 6 15 15 15h29c9 0 15-6 15-15V99h24c9 0 15-6 15-15V56c0-9-6-15-15-15H92V19c0-9-6-15-15-15H48Z"
        />
        <circle cx="62" cy="39" r="8" fill="#fff" />
        <path
          d="M47 56v24c0 11-9 16-18 10M70 92V57h12c17 0 18 20 0 20H70l23 17"
          fill="none"
          stroke="#fff"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="6"
        />
        <text className="brand-wordmark-main" x="153" y="58">JR Xpert</text>
        <text className="brand-wordmark-accent" x="374" y="58">HMS</text>
        <text className="brand-wordmark-subtitle" x="155" y="88">Hospital Management System</text>
        <text className="brand-wordmark-tagline" x="155" y="116">Better Care. Smarter Management. Healthier Tomorrow.</text>
      </svg>
    </span>
  );
}
