"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, LoaderCircle, LogOut, ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";

type ActiveSession = {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  current: boolean;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function SessionManager({ identity }: { identity: { name: string; email: string } }) {
  const router = useRouter();
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/auth/sessions", { cache: "no-store", credentials: "same-origin" });
      if (response.status === 401) {
        router.replace("/super-admin/login");
        router.refresh();
        return;
      }
      const result = await response.json().catch(() => null) as { sessions?: ActiveSession[]; message?: string } | null;
      if (!response.ok || !Array.isArray(result?.sessions)) throw new Error(result?.message ?? "Active sessions are temporarily unavailable.");
      setSessions(result.sessions);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Active sessions are temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { void loadSessions(); }, [loadSessions]);

  async function revoke(url: string, id: string, confirmation: string, success: string) {
    if (!window.confirm(confirmation)) return;
    setBusyId(id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(url, { method: id === "others" ? "POST" : "DELETE", credentials: "same-origin" });
      if (response.status === 401) {
        router.replace("/super-admin/login");
        router.refresh();
        return;
      }
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(result?.message ?? "The session could not be revoked.");
      }
      setNotice(success);
      await loadSessions();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The session could not be revoked.");
    } finally {
      setBusyId("");
    }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => undefined);
    router.replace("/super-admin/login");
    router.refresh();
  }

  const otherSessionCount = sessions.filter((session) => !session.current).length;

  return <main className="security-page">
    <header className="security-header"><BrandMark/><div className="security-identity"><span>PLATFORM CONTROL</span><strong>{identity.name}</strong><small>{identity.email}</small></div><Link className="security-back" href="/super-admin"><ArrowLeft size={15}/> Dashboard</Link><button className="security-signout" type="button" onClick={() => void signOut()}><LogOut size={15}/> Sign out</button></header>
    <section className="security-main" aria-labelledby="security-title">
      <div className="security-intro"><span className="auth-eyebrow"><ShieldCheck size={14}/> ACCOUNT SECURITY</span><h1 id="security-title">Active sessions</h1><p>Review and revoke sessions connected to this Super Admin account. Session data is limited to your own sign-ins.</p></div>
      {notice && <p className="security-notice" role="status">{notice}</p>}
      {error && <p className="security-error" role="alert">{error}</p>}
      <section className="security-card" aria-labelledby="session-list-title">
        <div className="security-card-heading"><div><h2 id="session-list-title">Your devices</h2><p>Sessions expire automatically after 12 hours.</p></div><button type="button" disabled={loading || busyId !== "" || otherSessionCount === 0} onClick={() => void revoke("/api/auth/sessions/revoke-others", "others", "Revoke every other active session for this account?", "Other active sessions were revoked.")}><ShieldCheck size={15}/> {busyId === "others" ? "Revoking…" : "Revoke other sessions"}</button></div>
        {loading && sessions.length === 0 ? <div className="security-state"><LoaderCircle size={19} className="auth-spin"/> Loading active sessions…</div> : sessions.length === 0 ? <div className="security-state"><ShieldCheck size={23}/><strong>No active sessions found</strong><span>Refresh the page to check again.</span><button type="button" onClick={() => void loadSessions()}>Refresh</button></div> : <div className="security-session-list">{sessions.map((session) => <article className="security-session" key={session.id}>
          <span className="security-device-icon"><ShieldCheck size={19}/></span>
          <div className="security-session-details"><div className="security-session-title"><strong>{session.current ? "This device" : "Signed-in device"}</strong>{session.current && <span className="security-current-badge">CURRENT</span>}</div><p title={session.userAgent ?? undefined}>{session.userAgent ? session.userAgent.slice(0, 180) : "Device details unavailable"}</p><dl><div><dt>Signed in</dt><dd>{formatDate(session.createdAt)}</dd></div><div><dt>Last active</dt><dd>{session.lastUsedAt ? formatDate(session.lastUsedAt) : "Not recorded"}</dd></div><div><dt>Expires</dt><dd>{formatDate(session.expiresAt)}</dd></div></dl></div>
          {!session.current && <button className="security-revoke" type="button" disabled={Boolean(busyId)} onClick={() => void revoke(`/api/auth/sessions/${encodeURIComponent(session.id)}`, session.id, "Revoke this session? That device will need to sign in again.", "The selected session was revoked.")}>{busyId === session.id ? "Revoking…" : "Revoke"}</button>}
        </article>)}</div>}
      </section>
      <p className="security-footnote">Revoking a session prevents that device from using its saved sign-in cookie. This page never displays session tokens.</p>
    </section>
  </main>;
}
