"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

export function PatientLogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function logout() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: "{}",
      });
      if (!response.ok && response.status !== 401) throw new Error("Sign out could not be completed.");
      router.replace("/login");
      router.refresh();
    } catch {
      setError("Sign out could not be completed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return <span className="patient-logout-control"><button className="patient-button patient-button-outline" type="button" onClick={() => void logout()} disabled={busy}>
    <LogOut size={15}/> {busy ? "Signing out…" : "Sign out"}
  </button>{error && <span className="patient-logout-error" role="alert">{error}</span>}</span>;
}
