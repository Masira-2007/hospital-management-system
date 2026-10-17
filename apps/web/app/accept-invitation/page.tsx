import type { Metadata } from "next";
import { InvitationSetupForm } from "@/components/onboarding-forms";
import "../auth.css";
import "../onboarding.css";

export const metadata: Metadata = { title: "Accept hospital invitation | JR Xpert HMS", robots: { index: false, follow: false } };

export default function AcceptInvitationPage() {
  return <InvitationSetupForm/>;
}
