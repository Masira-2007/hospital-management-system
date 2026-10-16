import type { Metadata } from "next";
import { LoginForm } from "@/components/auth-form";
import "../auth.css";

export const metadata: Metadata = {
  title: "Sign in | JR Xpert HMS",
  description: "Secure account sign-in for JR Xpert Hospital Management System.",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return <LoginForm />;
}
