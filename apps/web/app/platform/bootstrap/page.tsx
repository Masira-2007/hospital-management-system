import type { Metadata } from "next";
import { InvitationSetupForm } from "@/components/onboarding-forms";
import "../../auth.css";
import "../../onboarding.css";

export const metadata: Metadata = { title: "Secure platform administrator setup | JR Xpert HMS", robots: { index: false, follow: false } };

export default function PlatformBootstrapPage() {
  return <InvitationSetupForm platform/>;
}
