import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth-form";
import "../auth.css";

export const metadata: Metadata = { title: "Reset password | JR Xpert HMS", robots: { index: false, follow: false } };

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
