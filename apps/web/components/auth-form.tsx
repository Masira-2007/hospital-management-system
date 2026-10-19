"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Eye, EyeOff, HeartPulse, LockKeyhole, Mail, UserRound, Building2, CalendarDays, Pill, FlaskConical, CreditCard, Hospital, LoaderCircle } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";

type AuthMode = "HOSPITAL" | "PATIENT" | "SUPER_ADMIN";

export function LoginForm({ superAdmin = false }: { superAdmin?: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>(superAdmin ? "SUPER_ADMIN" : "HOSPITAL");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challengeToken, setChallengeToken] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailHint, setEmailHint] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("oauth");
    const returnedMode = params.get("mode");
    const provider = params.get("provider") === "apple" ? "Apple" : "Google";
    if (!superAdmin && (returnedMode === "HOSPITAL" || returnedMode === "PATIENT")) setMode(returnedMode);
    if (outcome === "unavailable") setMessage(`${provider} sign-in is not configured yet. Contact the system administrator.`);
    if (outcome === "error") setMessage("We couldn’t verify that sign-in. Please try again or use your password and email code.");
    if (outcome) {
      params.delete("oauth");
      params.delete("provider");
      params.delete("mode");
      const query = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    }
  }, [superAdmin]);

  async function requestEmailCode() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, password, mode, rememberMe }),
      });
      const result = await response.json().catch(() => null) as { requiresEmailCode?: boolean; challengeToken?: string; emailHint?: string; message?: string | string[] } | null;
      if (!response.ok) {
        const text = Array.isArray(result?.message) ? result.message.join(" ") : result?.message;
        setMessage(text || "We couldn’t start sign-in. Check your details or contact your administrator.");
        return;
      }
      if (response.status !== 202 || !result?.requiresEmailCode || !result.challengeToken) {
        setMessage("The sign-in service returned an unexpected response. Please try again.");
        return;
      }
      setChallengeToken(result.challengeToken);
      setEmailHint(result.emailHint ?? "your verified email address");
      setEmailCode("");
    } catch {
      setMessage("The secure sign-in service could not be reached. Try again later.");
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challengeToken) {
      await requestEmailCode();
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, password, mode, rememberMe, challengeToken, emailCode }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { message?: string | string[] } | null;
        const text = Array.isArray(result?.message) ? result.message.join(" ") : result?.message;
        setMessage(text || "We couldn’t sign you in. Check your details and code, then try again.");
        return;
      }
      router.replace(mode === "SUPER_ADMIN" ? "/super-admin" : "/workspace");
      router.refresh();
    } catch {
      setMessage("The secure sign-in service could not be reached. Try again later.");
    } finally {
      setBusy(false);
    }
  }

  function beginExternalSignIn(provider: "google" | "apple") {
    const params = new URLSearchParams({ mode, rememberMe: String(rememberMe) });
    window.location.assign(`/api/auth/oauth/${provider}?${params.toString()}`);
  }

  return <main className="auth-page">
    <section className="auth-story" aria-label="JR Xpert HMS information">
      <Link className="auth-brand" href="/site"><BrandMark /></Link>
      <div className="auth-story-copy">
        <span className="auth-eyebrow"><HeartPulse size={15}/> HOSPITAL MANAGEMENT SYSTEM</span>
        <h1>Better care begins with a <em>clearer view.</em></h1>
        <p>One connected workspace for the people, teams and day-to-day work behind every patient journey.</p>
        <div className="auth-feature-grid">
          <div><span><UserRound size={18}/></span><b>Patient journeys</b><small>Registration, visits and follow-up</small></div>
          <div><span><CalendarDays size={18}/></span><b>Appointments</b><small>Schedules and care coordination</small></div>
          <div><span><Pill size={18}/></span><b>Pharmacy</b><small>Medicine and stock workflows</small></div>
          <div><span><FlaskConical size={18}/></span><b>Diagnostics</b><small>Orders, samples and reports</small></div>
          <div><span><CreditCard size={18}/></span><b>Billing</b><small>Invoices and payment records</small></div>
          <div><span><Hospital size={18}/></span><b>Multiple hospitals</b><small>Teams in their authorized scope</small></div>
        </div>
      </div>
      <div className="auth-illustration" aria-hidden="true">
        <div className="auth-orbit orbit-one"/><div className="auth-orbit orbit-two"/>
        <div className="auth-hospital"><span><HeartPulse size={30}/></span><i/><i/><i/><i/><b/></div>
        <div className="auth-mini-card mini-a"><CalendarDays size={18}/><span><b>Care teams</b><small>Connected workflows</small></span></div>
        <div className="auth-mini-card mini-b"><HeartPulse size={18}/><span><b>JR Xpert HMS</b><small>Better Care. Smarter Management.</small></span></div>
      </div>
      <footer className="auth-story-footer"><span>JR XPERT HMS</span><span>Better Care. Smarter Management. Healthier Tomorrow.</span></footer>
    </section>

    <section className="auth-panel-wrap">
      <div className="auth-mobile-brand"><BrandMark compact /></div>
      <div className="auth-panel">
        <div className="auth-panel-brand"><BrandMark /></div>
        <span className="auth-eyebrow panel-eyebrow"><LockKeyhole size={14}/> {superAdmin ? "PLATFORM ADMINISTRATOR ACCESS" : "SECURE ACCOUNT ACCESS"}</span>
        <h2>{superAdmin ? "Administrator sign in" : "Welcome back"}</h2>
        <p className="auth-subtitle">{superAdmin ? "Use your platform administrator account and a one-time code sent to your verified email." : "Sign in with your password and a one-time email verification code."}</p>
        {!superAdmin && <div className="auth-mode" role="group" aria-label="Choose sign-in type">
          <button type="button" disabled={Boolean(challengeToken)} aria-pressed={mode === "HOSPITAL"} className={mode === "HOSPITAL" ? "selected" : ""} onClick={() => { setMode("HOSPITAL"); setMessage(""); }}><Building2 size={16}/> Hospital login</button>
          <button type="button" disabled={Boolean(challengeToken)} aria-pressed={mode === "PATIENT"} className={mode === "PATIENT" ? "selected" : ""} onClick={() => { setMode("PATIENT"); setMessage(""); }}><UserRound size={16}/> Patient login</button>
        </div>}
        <form className="auth-form" onSubmit={submit}>
          <label className="auth-label" htmlFor="login-email">Email address</label>
          <div className="auth-input-wrap"><Mail size={18}/><input id="login-email" name="email" type="email" autoComplete="username" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Enter your email address" /></div>
          <label className="auth-label" htmlFor="login-password">Password</label>
          <div className="auth-input-wrap"><LockKeyhole size={18}/><input id="login-password" name="password" type={visible ? "text" : "password"} autoComplete="current-password" required minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password"/><button className="auth-eye" type="button" onClick={() => setVisible((value) => !value)} aria-label={visible ? "Hide password" : "Show password"}>{visible ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div>
          <div className="auth-forgot-row"><Link href="/forgot-password">Forgot password?</Link></div>
          {challengeToken && <>
            <p className="auth-code-notice" role="status">A one-time code was sent to <strong>{emailHint}</strong>. It expires in 10 minutes.</p>
            <label className="auth-label" htmlFor="login-email-code">Email verification code</label>
            <div className="auth-input-wrap"><Mail size={18}/><input id="login-email-code" name="emailCode" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={emailCode} onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, ""))} placeholder="Enter the 6-digit code" /></div>
            <div className="auth-code-actions"><button type="button" onClick={() => void requestEmailCode()} disabled={busy}>Resend code</button><button type="button" onClick={() => { setChallengeToken(""); setEmailCode(""); setEmailHint(""); setMessage(""); }}>Use a different account</button></div>
          </>}
          {!superAdmin && <label className="auth-remember"><input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)}/><span>Remember me on this device</span></label>}
          {message && <p className="auth-message" role="alert">{message}</p>}
          <button className="auth-submit" type="submit" disabled={busy || Boolean(challengeToken && emailCode.length !== 6)}>{busy ? <><LoaderCircle size={18} className="auth-spin"/> {challengeToken ? "Verifying code…" : "Sending code…"}</> : <>{challengeToken ? "Verify code & sign in" : "Send email code"} <ArrowRight size={18}/></>}</button>
        </form>
        <div className="auth-social-divider"><span>or continue with</span></div>
        <div className="auth-social-buttons">
          <button type="button" onClick={() => beginExternalSignIn("google")} disabled={busy}>
            <span className="auth-google-mark" aria-hidden="true">G</span> Continue with Google
          </button>
          <button type="button" onClick={() => beginExternalSignIn("apple")} disabled={busy}>
            <svg className="auth-apple-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M16.37 12.57c.02 2.3 2.02 3.07 2.04 3.08-.02.06-.32 1.1-1.05 2.18-.63.94-1.29 1.87-2.33 1.89-1.02.02-1.35-.61-2.52-.61s-1.54.59-2.51.63c-1 .04-1.77-1.01-2.41-1.94-1.31-1.89-2.31-5.34-.97-7.66a3.72 3.72 0 0 1 3.14-1.91c.98-.02 1.9.66 2.5.66.6 0 1.73-.82 2.91-.7.49.02 1.87.2 2.76 1.51-.07.04-1.65.96-1.63 2.87ZM14.46 6.93a3.65 3.65 0 0 0 .84-2.61 3.72 3.72 0 0 0-2.4 1.23 3.44 3.44 0 0 0-.86 2.53 3.1 3.1 0 0 0 2.42-1.15Z"/></svg>
            Continue with Apple
          </button>
        </div>
        <p className="auth-provider-note">External sign-in works for existing verified accounts; it does not create a new account.</p>
        <p className="auth-help">{superAdmin ? "Platform administrator access is invitation-only." : <>Need access? <Link href="/register-hospital">Register a hospital</Link> or contact your administrator.</>}</p>
        <div className="auth-panel-footer"><Link href="/site"><ArrowLeft size={14}/> About JR Xpert HMS</Link><span>Better Care. Smarter Management. Healthier Tomorrow.</span></div>
      </div>
    </section>
  </main>;
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/auth/forgot-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const result = await response.json().catch(() => null) as { message?: string } | null;
      if (response.status === 202) setMessage(result?.message ?? "If the account is eligible, password reset instructions will be sent.");
      else setError(result?.message ?? "Password recovery is not available. Contact your hospital administrator.");
    } catch { setError("The secure service could not be reached. Try again later."); }
    finally { setBusy(false); }
  }

  return <AuthSimpleFrame title="Reset your password" description="Enter your account email. If it’s eligible, we’ll send one-time reset instructions.">
    <form className="auth-form" onSubmit={submit}>
      <label className="auth-label" htmlFor="recovery-email">Email address</label>
      <div className="auth-input-wrap"><Mail size={18}/><input id="recovery-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Enter your email address" /></div>
      {message && <p className="auth-success" role="status">{message}</p>}
      {error && <p className="auth-message" role="alert">{error}</p>}
      <button className="auth-submit" type="submit" disabled={busy}>{busy ? "Sending…" : "Request reset link"} <ArrowRight size={18}/></button>
    </form>
  </AuthSimpleFrame>;
}

export function ResetPasswordForm() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const raw = new URLSearchParams(window.location.hash.slice(1)).get("token");
    if (raw && /^[a-f0-9]{64}$/i.test(raw)) setToken(raw);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage("");
    if (password !== confirm) { setError("The passwords don’t match."); return; }
    if (!token) { setError("This reset link is missing or invalid. Request a new one."); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
      if (response.ok) setMessage("Your password has been reset. You can now sign in.");
      else setError("This reset link is invalid or expired. Request a new one.");
    } catch { setError("The secure service could not be reached. Try again later."); }
    finally { setBusy(false); }
  }

  return <AuthSimpleFrame title="Choose a new password" description="Use at least 12 characters. This will sign out other active sessions.">
    <form className="auth-form" onSubmit={submit}>
      <label className="auth-label" htmlFor="new-password">New password</label>
      <div className="auth-input-wrap"><LockKeyhole size={18}/><input id="new-password" type={visible ? "text" : "password"} autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Create a new password"/><button className="auth-eye" type="button" onClick={() => setVisible((value) => !value)} aria-label={visible ? "Hide password" : "Show password"}>{visible ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div>
      <label className="auth-label" htmlFor="confirm-password">Confirm new password</label>
      <div className="auth-input-wrap"><LockKeyhole size={18}/><input id="confirm-password" type={visible ? "text" : "password"} autoComplete="new-password" required minLength={12} maxLength={128} value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="Re-enter your password"/></div>
      {message && <p className="auth-success" role="status">{message} <Link href="/login">Sign in</Link></p>}
      {error && <p className="auth-message" role="alert">{error}</p>}
      <button className="auth-submit" type="submit" disabled={busy || Boolean(message)}>{busy ? "Updating…" : "Reset password"} <ArrowRight size={18}/></button>
    </form>
  </AuthSimpleFrame>;
}

function AuthSimpleFrame({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <main className="auth-simple"><Link className="auth-simple-brand" href="/site"><BrandMark/></Link><section className="auth-simple-card"><span className="auth-eyebrow"><LockKeyhole size={14}/> ACCOUNT RECOVERY</span><h1>{title}</h1><p>{description}</p>{children}<div className="auth-panel-footer"><Link href="/login"><ArrowLeft size={14}/> Back to sign in</Link><span>JR Xpert HMS</span></div></section></main>;
}
