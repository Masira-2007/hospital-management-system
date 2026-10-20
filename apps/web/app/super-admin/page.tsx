import type { Metadata } from "next";
import { requirePlatformIdentity } from "@/lib/platform-auth";
import { PlatformDashboard } from "@/components/onboarding-forms";
import "../auth.css";
import "../onboarding.css";
import "./dashboard.css";

export const metadata: Metadata = { title: "Platform administration | JR Xpert HMS", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function SuperAdminPage() {
  const identity = await requirePlatformIdentity();
  if (!identity) return <main className="onboarding-page"><section className="onboarding-card"><h1>Platform service unavailable</h1><p>We couldn’t verify the secure session with the platform API. Try again shortly.</p></section></main>;
  return <PlatformDashboard identity={identity}/>;
}
