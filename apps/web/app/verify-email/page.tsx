import type { Metadata } from "next";
import { VerifyApplicationEmail } from "@/components/onboarding-forms";
import "../auth.css";
import "../onboarding.css";

export const metadata: Metadata = { title: "Verify hospital email | JR Xpert HMS", robots: { index: false, follow: false } };

export default function VerifyEmailPage() {
  return <VerifyApplicationEmail/>;
}
