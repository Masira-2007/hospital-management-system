import type { Metadata } from "next";
import { LoginForm } from "@/components/auth-form";
import "../../auth.css";

export const metadata: Metadata = { title: "Platform administrator sign in | JR Xpert HMS", robots: { index: false, follow: false } };

export default function SuperAdminLoginPage() {
  return <LoginForm superAdmin/>;
}
