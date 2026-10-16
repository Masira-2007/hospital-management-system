import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth-form";
import "../auth.css";

export const metadata: Metadata = { title: "Password recovery | JR Xpert HMS", robots: { index: false, follow: false } };

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
