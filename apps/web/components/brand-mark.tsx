import Image from "next/image";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand-lockup${compact ? " brand-lockup-compact" : ""}`}>
      <Image
        className="brand-logo-image"
        src="/brand/jr-xpert-hms-logo.png"
        alt="JR Xpert HMS — Hospital Management System. Better Care. Smarter Management. Healthier Tomorrow."
        width={1447}
        height={399}
        priority={!compact}
      />
    </span>
  );
}
