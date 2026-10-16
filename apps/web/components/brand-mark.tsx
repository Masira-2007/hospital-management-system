import { useId } from "react";

export function BrandMark({ compact = false, inverse = false }: { compact?: boolean; inverse?: boolean }) {
  const gradientId = `jr-xpert-gradient-${useId().replaceAll(":", "")}`;

  return (
    <span className={`brand-lockup${compact ? " brand-lockup-compact" : ""}${inverse ? " brand-lockup-inverse" : ""}`}>
      <svg
        className="brand-logo-image"
        viewBox={compact ? "0 0 555 110" : "0 0 555 132"}
        role="img"
        aria-label="JR Xpert HMS — Hospital Management System. Better Care. Smarter Management. Healthier Tomorrow."
        focusable="false"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#073763" />
            <stop offset="0.52" stopColor="#087fa9" />
            <stop offset="1" stopColor="#079da7" />
          </linearGradient>
        </defs>
        <circle cx="54" cy="54" r="52" className="brand-emblem-halo" />
        <path
          className="brand-emblem"
          fill={`url(#${gradientId})`}
          d="M41 7h26a9 9 0 0 1 9 9v19h19a9 9 0 0 1 9 9v26a9 9 0 0 1-9 9H76v19a9 9 0 0 1-9 9H41a9 9 0 0 1-9-9V79H13a9 9 0 0 1-9-9V44a9 9 0 0 1 9-9h19V16a9 9 0 0 1 9-9Z"
        />
        <path
          d="M19 53h15l7-13 12 27 10-20 7 6h18"
          fill="none"
          stroke="#fff"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="4.5"
        />
        <text className="brand-wordmark-main" x="137" y="54">JR Xpert</text>
        <text className="brand-wordmark-accent" x="350" y="54">HMS</text>
        <text className="brand-wordmark-subtitle" x="140" y="82">Hospital Management System</text>
        {!compact && <text className="brand-wordmark-tagline" x="140" y="108">Better Care. Smarter Management. Healthier Tomorrow.</text>}
      </svg>
    </span>
  );
}
