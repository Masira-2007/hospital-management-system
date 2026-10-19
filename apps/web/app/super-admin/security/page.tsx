import type { Metadata } from "next";
import { SessionManager } from "@/components/session-manager";
import { requirePlatformIdentity } from "@/lib/platform-auth";
import "../../auth.css";
import "../../onboarding.css";
import "./security.css";

export const metadata: Metadata = { title: "Account security | JR Xpert HMS", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function SuperAdminSecurityPage() {
  const identity = await requirePlatformIdentity();
  if (!identity) return <main className="onboarding-page"><section className="onboarding-card"><h1>Platform service unavailable</h1><p>We couldn’t verify the secure session with the platform API. Try again shortly.</p></section></main>;
  return <SessionManager identity={identity}/>;
}
