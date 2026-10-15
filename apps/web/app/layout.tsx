import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "JR Xpert HMS | Hospital workspace",
  description: "JR Xpert Hospital Management System — Better Care. Smarter Management. Healthier Tomorrow.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
