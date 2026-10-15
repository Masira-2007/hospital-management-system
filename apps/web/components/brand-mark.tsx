export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand-lockup${compact ? " brand-lockup-compact" : ""}`} aria-label="JR Xpert HMS">
      <svg className="brand-symbol" viewBox="0 0 44 44" role="img" aria-label="">
        <path d="M22 2.5c2.5 0 4.5 2 4.5 4.5v4.2h4.2c2.5 0 4.5 2 4.5 4.5v4.2h2.2c2.5 0 4.5 2 4.5 4.5s-2 4.5-4.5 4.5h-2.2v4.2c0 2.5-2 4.5-4.5 4.5h-4.2v2.2c0 2.5-2 4.5-4.5 4.5s-4.5-2-4.5-4.5v-2.2h-4.2c-2.5 0-4.5-2-4.5-4.5v-4.2H6.5C4 29.1 2 27.1 2 24.6s2-4.5 4.5-4.5h2.3v-4.2c0-2.5 2-4.5 4.5-4.5h4.2V7c0-2.5 2-4.5 4.5-4.5Z" fill="currentColor" opacity=".18" />
        <path d="M20 7.8h4v8.3h8.3v4h-8.3v8.3h-4v-8.3h-8.3v-4H20V7.8Z" fill="currentColor" />
        <path d="M12.2 31.8c1.4-3.1 3.7-4.7 6.8-4.7h6c3.1 0 5.4 1.6 6.8 4.7" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
        <circle cx="22" cy="25" r="2.3" fill="currentColor" />
      </svg>
      <span className="brand-copy">
        <span className="brand-name">JR Xpert<span> HMS</span></span>
        {!compact && <span className="brand-subtitle">Hospital Management System</span>}
      </span>
    </div>
  );
}
