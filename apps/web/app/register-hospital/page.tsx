import type { Metadata } from "next";
import { HospitalApplicationForm } from "@/components/onboarding-forms";
import "../auth.css";
import "../onboarding.css";

export const metadata: Metadata = { title: "Register a hospital | JR Xpert HMS", robots: { index: false, follow: false } };

export default function RegisterHospitalPage() {
  return <HospitalApplicationForm/>;
}
