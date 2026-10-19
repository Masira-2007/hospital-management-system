"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, LogOut, UserRound, LoaderCircle } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";

type Identity = {
  user: { id: string; email: string; displayName: string };
  selectedMembershipId: string | null;
  memberships: Array<{
    id: string;
    role: string;
    department: string | null;
    organization: { id: string; name: string; slug: string };
    hospital: { id: string; name: string } | null;
    branch: { id: string; name: string } | null;
  }>;
};

export function WorkspaceHome() {
  const router = useRouter();
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [selectedMembershipId, setSelectedMembershipId] = useState<string | null>(null);
  const [busyMembershipId, setBusyMembershipId] = useState("");
  const [selectionError, setSelectionError] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        if (response.status === 401) { router.replace("/login"); return null; }
        if (!response.ok) throw new Error("unavailable");
        return await response.json() as Identity;
      })
      .then((result) => { if (active && result) { setIdentity(result); setSelectedMembershipId(result.selectedMembershipId ?? null); setState("ready"); } })
      .catch(() => { if (active) setState("error"); });
    return () => { active = false; };
  }, [router]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => undefined);
    router.replace("/login");
    router.refresh();
  }

  async function selectMembership(membershipId: string) {
    setBusyMembershipId(membershipId);
    setSelectionError("");
    try {
      const response = await fetch("/api/auth/select-membership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ membershipId }),
      });
      const result = await response.json().catch(() => null) as { selectedMembershipId?: string; message?: string } | null;
      if (response.status === 401) { router.replace("/login"); return; }
      if (!response.ok || result?.selectedMembershipId !== membershipId) {
        throw new Error(result?.message ?? "We couldn’t select that workspace. Refresh your affiliations and try again.");
      }
      setSelectedMembershipId(membershipId);
    } catch (reason) {
      setSelectionError(reason instanceof Error ? reason.message : "Workspace selection is temporarily unavailable.");
    } finally {
      setBusyMembershipId("");
    }
  }

  return <main className="workspace-auth-page">
    <header className="workspace-auth-header"><BrandMark/><button type="button" onClick={logout}><LogOut size={16}/> Sign out</button></header>
    <section className="workspace-auth-card">
      {state === "loading" && <div className="workspace-loading"><LoaderCircle className="auth-spin"/> Checking your secure session…</div>}
      {state === "error" && <div className="workspace-error" role="alert"><h1>Workspace unavailable</h1><p>We couldn’t verify your session with the secure service. Please try again shortly.</p><button type="button" onClick={() => location.reload()}>Try again</button></div>}
      {state === "ready" && identity && <>
        <span className="auth-eyebrow"><UserRound size={14}/> SIGNED IN</span>
        <h1>Welcome, {identity.user.displayName}</h1>
        <p className="workspace-email">{identity.user.email}</p>
        <div className="workspace-affiliations"><h2>{identity.memberships.length > 1 ? "Choose an authorized workspace" : "Your authorized affiliations"}</h2>
          {identity.memberships.length > 1 && <p className="workspace-selection-help">Choose the hospital and role for this session. Access is checked against your active membership every time.</p>}
          {selectionError && <p className="workspace-selection-error" role="alert">{selectionError}</p>}
          {identity.memberships.length ? identity.memberships.map((membership) => <article className={selectedMembershipId === membership.id ? "selected" : ""} key={membership.id}>
            <span className="workspace-hospital-icon"><Building2 size={18}/></span><div><b>{membership.hospital?.name ?? membership.organization.name}</b><small>{membership.organization.name}{membership.branch ? ` · ${membership.branch.name}` : ""}</small></div><span className="workspace-role">{membership.role.replaceAll("_", " ")}</span>
            {identity.memberships.length > 1 && <button className="workspace-select-button" type="button" aria-pressed={selectedMembershipId === membership.id} disabled={Boolean(busyMembershipId) || selectedMembershipId === membership.id} onClick={() => void selectMembership(membership.id)}>{busyMembershipId === membership.id ? "Selecting…" : selectedMembershipId === membership.id ? "Selected" : "Use this workspace"}</button>}
          </article>) : <p>No active hospital membership is linked to this account. Contact your organization administrator.</p>}
        </div>
        <div className="workspace-scope-note"><b>Account access is active.</b><span>Clinical and operational modules will appear here when your organization enables them.</span></div>
      </>}
    </section>
    <footer className="workspace-auth-footer">JR Xpert HMS <span>Better Care. Smarter Management. Healthier Tomorrow.</span></footer>
  </main>;
}
