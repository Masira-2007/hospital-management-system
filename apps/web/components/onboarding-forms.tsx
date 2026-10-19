"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, BadgeCheck, Building2, Eye, EyeOff, HeartPulse, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";

type ApiResult = { message?: string; authenticatorSecret?: string; authenticatorUri?: string; challengeToken?: string; emailHint?: string; nextStep?: string };
type PlatformHospital = {
  id: string; name: string; slug: string; status: string; createdAt: string;
  organization: { id: string; name: string; status: string };
  _count: { branches: number; memberships: number };
  subscriptions: Array<{ status: string; currentPeriodEnd: string; plan: { code: string; name: string } }>;
};
type PlatformAuditEvent = {
  id: string; actorUserId: string | null; action: string; resourceType: string; resourceId: string | null; createdAt: string;
  actor: { displayName: string } | null; organization: { id: string; name: string } | null;
};
type PlatformAuditPagination = { page: number; pageSize: number; total: number; pages: number };
type PlatformSubscription = {
  id: string; status: string; trialEndsAt: string | null; currentPeriodStart: string; currentPeriodEnd: string; canceledAt: string | null;
  plan: { code: string; name: string; active: boolean };
  hospital: { id: string; name: string; slug: string; organization: { id: string; name: string; status: string }; _count: { branches: number; memberships: number } };
};
type PlatformSubscriptionPagination = { page: number; pageSize: number; total: number; pages: number };
type PlatformSystemHealth = { status: "operational" | "degraded"; checks: { database: "connected" | "unavailable"; emailDelivery: "configured" | "needs_setup" }; checkedAt: string };

const initialApplication = {
  hospitalName: "", hospitalType: "GENERAL", officialEmail: "", contactPhone: "", website: "", streetAddress: "",
  city: "", state: "", country: "India", postalCode: "", bedCount: "", branchCount: "1", representativeName: "",
  representativeDesignation: "", proposedAdminName: "", proposedAdminEmail: "", termsAccepted: false,
};

export function HospitalApplicationForm() {
  const [form, setForm] = useState(initialApplication);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  function update(name: keyof typeof initialApplication, value: string | boolean) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/v1/hospital-applications", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ ...form, bedCount: Number(form.bedCount), branchCount: Number(form.branchCount), ...(form.website ? {} : { website: undefined }) }),
      });
      const data = await response.json().catch(() => null) as ApiResult | null;
      if (!response.ok) throw new Error(response.status === 429 ? "Too many applications were submitted. Please wait and try again." : data?.message ?? "We couldn’t submit the application. Please review the form and try again.");
      setSuccess(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The secure application service could not be reached.");
    } finally { setBusy(false); }
  }

  return <OnboardingFrame kicker="HOSPITAL ONBOARDING" title={success ? "Check your official inbox" : "Register your hospital"} description={success ? "If the application can be accepted, we’ve sent an email verification link to the official address you provided. Verify that address before the application enters review." : "Share your hospital details for a review by the JR Xpert team. Submitting this form does not activate an account or grant access."}>
    {success ? <div className="onboarding-success"><BadgeCheck size={22}/><p>Email verification is required before review. If the message does not arrive, check your spam folder or submit again after the link expires.</p><Link href="/login">Return to sign in <ArrowRight size={15}/></Link></div> : <form className="onboarding-form" onSubmit={submit}>
      <section className="onboarding-section"><h2><Building2 size={17}/> Hospital details</h2><div className="onboarding-grid">
        <Field label="Hospital or clinic name" name="hospitalName" value={form.hospitalName} onChange={(v) => update("hospitalName", v)} required maxLength={160}/>
        <label className="onboarding-field"><span>Facility type</span><select value={form.hospitalType} onChange={(e) => update("hospitalType", e.target.value)}><option value="GENERAL">General hospital</option><option value="MULTISPECIALTY">Multispecialty hospital</option><option value="CLINIC">Clinic</option><option value="DIAGNOSTIC">Diagnostic center</option><option value="OTHER">Other</option></select></label>
        <Field label="Official hospital email" name="officialEmail" type="email" value={form.officialEmail} onChange={(v) => update("officialEmail", v)} required maxLength={254}/>
        <Field label="Contact phone" name="contactPhone" type="tel" value={form.contactPhone} onChange={(v) => update("contactPhone", v)} required maxLength={24} placeholder="Include country code"/>
        <Field label="Website (optional)" name="website" type="url" value={form.website} onChange={(v) => update("website", v)} maxLength={255} placeholder="https://"/>
        <Field label="Street address" name="streetAddress" value={form.streetAddress} onChange={(v) => update("streetAddress", v)} required maxLength={240}/>
        <Field label="City" name="city" value={form.city} onChange={(v) => update("city", v)} required maxLength={100}/>
        <Field label="State / province" name="state" value={form.state} onChange={(v) => update("state", v)} required maxLength={100}/>
        <Field label="Country" name="country" value={form.country} onChange={(v) => update("country", v)} required maxLength={100}/>
        <Field label="Postal code" name="postalCode" value={form.postalCode} onChange={(v) => update("postalCode", v)} required maxLength={20}/>
        <Field label="Number of beds" name="bedCount" type="number" min={1} max={100000} value={form.bedCount} onChange={(v) => update("bedCount", v)} required/>
        <Field label="Number of branches" name="branchCount" type="number" min={1} max={500} value={form.branchCount} onChange={(v) => update("branchCount", v)} required/>
      </div></section>
      <section className="onboarding-section"><h2><Mail size={17}/> Authorized representative</h2><div className="onboarding-grid">
        <Field label="Representative name" name="representativeName" value={form.representativeName} onChange={(v) => update("representativeName", v)} required maxLength={120}/>
        <Field label="Designation" name="representativeDesignation" value={form.representativeDesignation} onChange={(v) => update("representativeDesignation", v)} required maxLength={100}/>
        <Field label="Proposed hospital admin name" name="proposedAdminName" value={form.proposedAdminName} onChange={(v) => update("proposedAdminName", v)} required maxLength={120}/>
        <Field label="Proposed admin email" name="proposedAdminEmail" type="email" value={form.proposedAdminEmail} onChange={(v) => update("proposedAdminEmail", v)} required maxLength={254}/>
      </div></section>
      <label className="onboarding-consent"><input type="checkbox" checked={form.termsAccepted} onChange={(e) => update("termsAccepted", e.target.checked)} required/><span>I confirm I’m authorized to submit these details and agree that JR Xpert may contact me about this application.</span></label>
      {error && <p className="onboarding-error" role="alert">{error}</p>}
      <button className="onboarding-submit" type="submit" disabled={busy}>{busy ? "Submitting securely…" : "Submit for review"}<ArrowRight size={16}/></button>
      <p className="onboarding-note"><ShieldCheck size={15}/> Application details are restricted to onboarding review. Do not enter patient information here.</p>
    </form>}
  </OnboardingFrame>;
}

export function VerifyApplicationEmail() {
  const [state, setState] = useState<"checking" | "success" | "error">("checking");
  const [message, setMessage] = useState("Verifying your email link…");
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
    window.history.replaceState(null, "", window.location.pathname);
    if (!token || !/^[a-f0-9]{64}$/i.test(token)) { setState("error"); setMessage("This verification link is missing or invalid. Submit the application again to request a new link."); return; }
    let active = true;
    fetch("/api/v1/hospital-applications/verify-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })
      .then(async (response) => {
        const data = await response.json().catch(() => null) as ApiResult | null;
        if (!response.ok) throw new Error(data?.message ?? "This verification link is invalid or expired.");
        if (active) { setState("success"); setMessage(data?.message ?? "Your official email has been verified."); }
      })
      .catch((reason: unknown) => { if (active) { setState("error"); setMessage(reason instanceof Error ? reason.message : "Verification could not be completed."); } });
    return () => { active = false; };
  }, []);
  return <OnboardingFrame kicker="EMAIL VERIFICATION" title={state === "success" ? "Email verified" : state === "error" ? "Link unavailable" : "Verifying your email"} description={message}>
    <div className={`onboarding-state ${state}`} aria-live="polite">{state === "checking" ? <span className="onboarding-spinner"/> : state === "success" ? <BadgeCheck size={23}/> : <Mail size={23}/>}<Link href="/login">Continue to sign in <ArrowRight size={15}/></Link></div>
  </OnboardingFrame>;
}

export function InvitationSetupForm({ platform = false }: { platform?: boolean }) {
  const [token, setToken] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [prepared, setPrepared] = useState(false);
  const [secret, setSecret] = useState("");
  const [authenticatorUri, setAuthenticatorUri] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [challengeToken, setChallengeToken] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailHint, setEmailHint] = useState("");
  const [existingMode, setExistingMode] = useState(false);
  const [existingEmail, setExistingEmail] = useState("");
  const [existingPassword, setExistingPassword] = useState("");
  const [existingMfaCode, setExistingMfaCode] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    if (/^[a-f0-9]{64}$/i.test(value)) setToken(value);
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if (password !== confirm) { setError("The passwords don’t match."); return; }
    setBusy(true);
    try {
      const path = platform ? "/api/v1/platform/bootstrap/prepare" : "/api/v1/hospital-invitations/prepare";
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, displayName, password }) });
      const data = await response.json().catch(() => null) as ApiResult | null;
      if (!response.ok) throw new Error(data?.message ?? "This setup link is invalid or expired.");
      setSecret(data?.authenticatorSecret ?? ""); setAuthenticatorUri(data?.authenticatorUri ?? "");
      setChallengeToken(data?.challengeToken ?? ""); setEmailHint(data?.emailHint ?? "your verified email address");
      setPrepared(true); setPassword(""); setConfirm("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Secure setup is unavailable. Please try again."); }
    finally { setBusy(false); }
  }

  async function complete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const path = platform ? "/api/v1/platform/bootstrap/complete" : "/api/v1/hospital-invitations/complete";
      const body = platform ? { token, challengeToken, emailCode } : { token, mfaCode };
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => null) as ApiResult | null;
      if (!response.ok) throw new Error(data?.message ?? (platform ? "The email verification code was not accepted." : "The authenticator code was not accepted."));
      setSuccess(true); setSecret(""); setAuthenticatorUri("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Secure setup could not be completed."); }
    finally { setBusy(false); }
  }

  async function resendPlatformCode() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/v1/platform/bootstrap/resend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const data = await response.json().catch(() => null) as ApiResult | null;
      if (!response.ok || !data?.challengeToken) throw new Error(data?.message ?? "A new verification code could not be sent.");
      setChallengeToken(data.challengeToken); setEmailHint(data.emailHint ?? "your verified email address"); setEmailCode("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "A new verification code could not be sent."); }
    finally { setBusy(false); }
  }

  async function acceptWithExistingAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const login = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ email: existingEmail, password: existingPassword, mode: "HOSPITAL", mfaCode: existingMfaCode }),
      });
      if (!login.ok) throw new Error("Sign in failed. Check your credentials and authenticator code.");
      setExistingPassword("");
      const response = await fetch("/api/v1/hospital-invitations/accept-existing", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ token }),
      });
      const data = await response.json().catch(() => null) as ApiResult | null;
      if (!response.ok) throw new Error(data?.message ?? "This invitation cannot be added to the signed-in account.");
      setSuccess(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The secure service could not complete this request."); }
    finally { setBusy(false); }
  }

  if (success) return <OnboardingFrame kicker="ACCOUNT SECURITY" title={existingMode ? "Invitation accepted" : "Your account is ready"} description={existingMode ? "This account now has authorized access to the hospital workspace." : platform ? "First administrator setup is complete. Sign in with your password and an email verification code." : "Hospital administrator setup is complete. Sign in with your password and authenticator code."}>
    <div className="onboarding-success"><BadgeCheck size={22}/><Link href={existingMode ? "/workspace" : platform ? "/super-admin/login" : "/login"}>{existingMode ? "Open workspace" : "Sign in securely"} <ArrowRight size={15}/></Link></div>
  </OnboardingFrame>;

  return <OnboardingFrame kicker={platform ? "FIRST PLATFORM ADMINISTRATOR" : "HOSPITAL ADMIN INVITATION"} title={platform ? "Secure your administrator account" : existingMode ? "Accept your hospital invitation" : "Set up your hospital account"} description={!token ? "This one-time setup link is missing or invalid. Open the complete link from the invitation email." : existingMode ? "Sign in with the invited email and your authenticator to add this hospital to your existing account." : prepared ? platform ? `Enter the one-time email verification code sent to ${emailHint}.` : "Add the secret to an authenticator app and confirm a current six-digit code." : platform ? "Create your password. We’ll email a one-time verification code before activating your account." : "Create your password. You’ll also set up an authenticator before the account is activated."}>
    {!token ? <div className="onboarding-state error"><Mail size={22}/><Link href={platform ? "/super-admin/login" : "/login"}>Return to sign in</Link></div> : prepared ? <form className="onboarding-form" onSubmit={complete}>
      {platform ? <>
        <p className="onboarding-note"><Mail size={15}/> A six-digit code was sent to <strong>{emailHint}</strong>. It expires in 10 minutes and can only be used once.</p>
        <label className="onboarding-field"><span>Email verification code</span><input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={emailCode} onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, ""))} required/></label>
        <button className="onboarding-text-button" type="button" onClick={() => void resendPlatformCode()} disabled={busy}>Send a new email code</button>
      </> : <>
        <div className="onboarding-secret"><strong>Authenticator setup key</strong><code>{secret}</code>{authenticatorUri && <a href={authenticatorUri}>Open in an authenticator app</a>}<small>Keep this private. It is shown once; save it in your authenticator before continuing.</small></div>
        <label className="onboarding-field"><span>6-digit authenticator code</span><input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))} required/></label>
      </>}
      {error && <p className="onboarding-error" role="alert">{error}</p>}
      <button className="onboarding-submit" disabled={busy || (platform ? emailCode.length !== 6 || !challengeToken : mfaCode.length !== 6)}>{busy ? "Confirming…" : "Confirm and activate account"}<ShieldCheck size={16}/></button>
    </form> : !platform && existingMode ? <form className="onboarding-form" onSubmit={acceptWithExistingAccount}>
      <p className="onboarding-note">Sign in with the email address this invitation was sent to. An active authenticator-enabled account is required.</p>
      <label className="onboarding-field"><span>Email address</span><input type="email" autoComplete="username" maxLength={254} value={existingEmail} onChange={(e) => setExistingEmail(e.target.value)} required/></label>
      <label className="onboarding-field"><span>Password</span><input type="password" autoComplete="current-password" minLength={12} maxLength={128} value={existingPassword} onChange={(e) => setExistingPassword(e.target.value)} required/></label>
      <label className="onboarding-field"><span>Authenticator code</span><input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={existingMfaCode} onChange={(e) => setExistingMfaCode(e.target.value.replace(/\D/g, ""))} required/></label>
      {error && <p className="onboarding-error" role="alert">{error}</p>}
      <button className="onboarding-submit" disabled={busy}>{busy ? "Checking account…" : "Sign in and accept invitation"}<ShieldCheck size={16}/></button>
      <button className="onboarding-text-button" type="button" onClick={() => { setExistingMode(false); setError(""); }}>Set up a new hospital account instead</button>
    </form> : <>
      {!platform && <button className="onboarding-text-button onboarding-existing-link" type="button" onClick={() => { setExistingMode(true); setError(""); }}>Already have an account? Sign in to accept this invitation</button>}
      <form className="onboarding-form" onSubmit={prepare}>
      <label className="onboarding-field"><span>Your full name</span><input autoComplete="name" minLength={2} maxLength={120} value={displayName} onChange={(e) => setDisplayName(e.target.value)} required/></label>
      <label className="onboarding-field"><span>Create password (12–128 characters)</span><div className="onboarding-password"><input type={visible ? "text" : "password"} autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} required/><button type="button" aria-label={visible ? "Hide password" : "Show password"} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></label>
      <label className="onboarding-field"><span>Confirm password</span><input type={visible ? "text" : "password"} autoComplete="new-password" minLength={12} maxLength={128} value={confirm} onChange={(e) => setConfirm(e.target.value)} required/></label>
      {error && <p className="onboarding-error" role="alert">{error}</p>}
      <button className="onboarding-submit" disabled={busy}>{busy ? "Preparing secure setup…" : platform ? "Continue to email verification" : "Continue to authenticator setup"}<ArrowRight size={16}/></button>
      <p className="onboarding-note"><LockKeyhole size={15}/> Account access stays disabled until the {platform ? "email code" : "authenticator code"} is confirmed.</p>
      </form>
    </>}
  </OnboardingFrame>;
}

export function PlatformDashboard({ identity }: { identity: { name: string; email: string } }) {
  const router = useRouter();
  const [applications, setApplications] = useState<Array<Record<string, unknown>>>([]);
  const [hospitals, setHospitals] = useState<PlatformHospital[]>([]);
  const [subscriptions, setSubscriptions] = useState<PlatformSubscription[]>([]);
  const [subscriptionPagination, setSubscriptionPagination] = useState<PlatformSubscriptionPagination>({ page: 1, pageSize: 25, total: 0, pages: 0 });
  const [auditEvents, setAuditEvents] = useState<PlatformAuditEvent[]>([]);
  const [auditPagination, setAuditPagination] = useState<PlatformAuditPagination>({ page: 1, pageSize: 25, total: 0, pages: 0 });
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [systemHealth, setSystemHealth] = useState<PlatformSystemHealth | null>(null);
  const [selectedStatus, setSelectedStatus] = useState("PENDING_REVIEW");
  const [hospitalStatus, setHospitalStatus] = useState("");
  const [hospitalSearch, setHospitalSearch] = useState("");
  const [subscriptionStatus, setSubscriptionStatus] = useState("");
  const [subscriptionSearchInput, setSubscriptionSearchInput] = useState("");
  const [subscriptionSearch, setSubscriptionSearch] = useState("");
  const [subscriptionPage, setSubscriptionPage] = useState(1);
  const [auditAction, setAuditAction] = useState("");
  const [auditPage, setAuditPage] = useState(1);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [auditError, setAuditError] = useState("");
  const [subscriptionError, setSubscriptionError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setError("");
    setAuditError("");
    setSubscriptionError("");
    try {
      const auditParams = new URLSearchParams({ page: String(auditPage), pageSize: "25" });
      if (auditAction) auditParams.set("action", auditAction);
      const subscriptionParams = new URLSearchParams({ page: String(subscriptionPage), pageSize: "25" });
      if (subscriptionStatus) subscriptionParams.set("status", subscriptionStatus);
      if (subscriptionSearch) subscriptionParams.set("search", subscriptionSearch);
      const [overview, applicationList, auditList, subscriptionList] = await Promise.all([
        fetch("/api/v1/platform/dashboard", { cache: "no-store" }),
        fetch(`/api/v1/platform/applications?status=${encodeURIComponent(selectedStatus)}`, { cache: "no-store" }),
        fetch(`/api/v1/platform/audit-events?${auditParams}`, { cache: "no-store" }),
        fetch(`/api/v1/platform/subscriptions?${subscriptionParams}`, { cache: "no-store" }),
      ]);
      const healthResponse = await fetch("/api/v1/platform/system-health", { cache: "no-store" });
      const hospitalParams = new URLSearchParams({ page: "1", pageSize: "50" });
      if (hospitalStatus) hospitalParams.set("status", hospitalStatus);
      if (hospitalSearch.trim()) hospitalParams.set("search", hospitalSearch.trim());
      const hospitalList = await fetch(`/api/v1/platform/hospitals?${hospitalParams}`, { cache: "no-store" });
      if (overview.status === 401 || applicationList.status === 401 || hospitalList.status === 401 || auditList.status === 401 || subscriptionList.status === 401 || healthResponse.status === 401) { router.replace("/super-admin/login"); return; }
      if (!overview.ok || !applicationList.ok || !hospitalList.ok) throw new Error("The secure platform service could not load the dashboard.");
      const data = await overview.json() as Record<string, unknown>;
      const list = await applicationList.json() as { applications?: Array<Record<string, unknown>> };
      const hospitalData = await hospitalList.json() as { hospitals?: PlatformHospital[] };
      setSummary(data); setApplications(list.applications ?? []); setHospitals(hospitalData.hospitals ?? []);
      setSystemHealth(healthResponse.ok ? await healthResponse.json() as PlatformSystemHealth : null);
      if (subscriptionList.ok) {
        const subscriptionData = await subscriptionList.json() as { subscriptions?: PlatformSubscription[]; pagination?: PlatformSubscriptionPagination };
        setSubscriptions(subscriptionData.subscriptions ?? []);
        if (subscriptionData.pagination) setSubscriptionPagination(subscriptionData.pagination);
      } else {
        setSubscriptions([]);
        setSubscriptionError("Subscription status is temporarily unavailable. Refresh to try again.");
      }
      if (auditList.ok) {
        const auditData = await auditList.json() as { events?: PlatformAuditEvent[]; pagination?: PlatformAuditPagination };
        setAuditEvents(auditData.events ?? []);
        if (auditData.pagination) setAuditPagination(auditData.pagination);
      } else {
        setAuditEvents([]);
        setAuditError("Audit activity is temporarily unavailable. Refresh to try again.");
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Dashboard unavailable."); }
  }

  useEffect(() => { void load(); }, [selectedStatus, hospitalStatus, auditAction, auditPage, subscriptionStatus, subscriptionSearch, subscriptionPage]); // eslint-disable-line react-hooks/exhaustive-deps

  async function action(url: string, body: unknown, successText: string) {
    setBusyId(url); setError(""); setNotice("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => null) as { message?: string; invitation?: { deliveryStatus?: string } } | null;
      if (!response.ok) throw new Error(data?.message ?? "The action could not be completed.");
      setNotice(data?.invitation?.deliveryStatus === "FAILED" ? "The change was saved, but email delivery failed. Check email configuration before retrying." : successText);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The action could not be completed."); }
    finally { setBusyId(""); }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => undefined);
    router.replace("/super-admin/login"); router.refresh();
  }

  return <main className="platform-page"><header className="platform-header"><BrandMark/><div><span>PLATFORM CONTROL</span><strong>{identity.name}</strong><small>{identity.email}</small></div><button onClick={signOut}>Sign out</button></header>
    <section className="platform-main"><div className="platform-welcome"><div><span className="auth-eyebrow"><ShieldCheck size={14}/> SUPER ADMIN</span><h1>Hospital onboarding</h1><p>Review verified applications and provision hospital access. Clinical records are not exposed in this console.</p></div><Link href="/site">JR Xpert site <ArrowRight size={15}/></Link></div>
      <div className="platform-metrics">{metric("Applications awaiting review", (summary?.applications as Record<string, number> | undefined)?.PENDING_REVIEW ?? 0)}{metric("Active hospitals", (summary?.hospitals as Record<string, number> | undefined)?.ACTIVE ?? 0)}{metric("Provisioning hospitals", (summary?.hospitals as Record<string, number> | undefined)?.PROVISIONING ?? 0)}{metric("Active accounts", summary?.activeUsers ?? 0)}{metric("Active subscriptions", (summary?.subscriptions as Record<string, number> | undefined)?.ACTIVE ?? 0)}{metric("Past-due subscriptions", (summary?.subscriptions as Record<string, number> | undefined)?.PAST_DUE ?? 0)}</div>
      <section className="platform-system-health" aria-labelledby="platform-system-health-title"><div><h2 id="platform-system-health-title">Platform services</h2><p>Operational checks only; no credentials or patient information are shown.</p></div>{systemHealth ? <div className="platform-health-checks"><article><span className={`platform-status ${systemHealth.checks.database === "connected" ? "status-active" : "status-suspended"}`}>{systemHealth.checks.database === "connected" ? "CONNECTED" : "UNAVAILABLE"}</span><strong>Neon PostgreSQL</strong></article><article><span className={`platform-status ${systemHealth.checks.emailDelivery === "configured" ? "status-active" : "status-provisioning"}`}>{systemHealth.checks.emailDelivery === "configured" ? "CONFIGURED" : "NEEDS SETUP"}</span><strong>Email delivery</strong><small>Provider acceptance is checked when an email is sent.</small></article></div> : <p className="platform-health-unavailable">Service health is temporarily unavailable. Refresh the dashboard to retry.</p>}</section>
      <div className="platform-list-heading"><div><h2>Hospitals</h2><p>Manage tenant availability and inspect non-clinical account metadata.</p></div><div className="platform-hospital-tools"><label><span className="sr-only">Search hospitals</span><input aria-label="Search hospitals" placeholder="Search by hospital or organization" value={hospitalSearch} onChange={(event) => setHospitalSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(); }}/></label><select aria-label="Filter hospital status" value={hospitalStatus} onChange={(event) => setHospitalStatus(event.target.value)}><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option><option value="PROVISIONING">Provisioning</option><option value="DEACTIVATED">Deactivated</option></select><button type="button" onClick={() => void load()}>Search</button></div></div>
      {hospitals.length === 0 ? <div className="platform-empty"><Building2 size={25}/><h3>No hospitals found</h3><p>Approved applications will appear here once their administrator completes secure onboarding.</p></div> : <div className="platform-hospital-table-wrap"><table className="platform-hospital-table"><thead><tr><th>HOSPITAL</th><th>ORGANIZATION</th><th>STATUS</th><th>BRANCHES</th><th>MEMBERS</th><th>PLAN</th><th>ACTION</th></tr></thead><tbody>{hospitals.map((hospital) => {
        const subscription = hospital.subscriptions[0];
        const canChangeStatus = hospital.status === "ACTIVE" || hospital.status === "SUSPENDED";
        const actionName = hospital.status === "ACTIVE" ? "SUSPEND" : "REACTIVATE";
        return <tr key={hospital.id}><td><b>{hospital.name}</b><small>{hospital.slug}</small></td><td>{hospital.organization.name}</td><td><span className={`platform-status status-${hospital.status.toLowerCase()}`}>{hospital.status.replaceAll("_", " ")}</span></td><td>{hospital._count.branches}</td><td>{hospital._count.memberships}</td><td>{subscription ? `${subscription.plan.name} · ${subscription.status.replaceAll("_", " ")}` : "No subscription"}</td><td>{canChangeStatus && <button className={actionName === "SUSPEND" ? "platform-table-danger" : "platform-table-action"} disabled={Boolean(busyId)} onClick={() => { const reason = window.prompt(`${actionName === "SUSPEND" ? "Reason for suspending" : "Reason for reactivating"} ${hospital.name} (at least 10 characters):`); if (reason) void action(`/api/v1/platform/hospitals/${encodeURIComponent(hospital.id)}/status`, { action: actionName, reason }, actionName === "SUSPEND" ? "Hospital suspended." : "Hospital reactivated."); }}>{busyId.includes(hospital.id) ? "Saving…" : actionName === "SUSPEND" ? "Suspend" : "Reactivate"}</button>}</td></tr>;
      })}</tbody></table></div>}
      <section aria-labelledby="platform-subscriptions-title">
        <div className="platform-list-heading"><div><h2 id="platform-subscriptions-title">Subscriptions and tenant usage</h2><p>Operational subscription dates and tenant counts only. No patient records or payment details are available here.</p></div><div className="platform-hospital-tools"><form onSubmit={(event) => { event.preventDefault(); setSubscriptionPage(1); setSubscriptionSearch(subscriptionSearchInput.trim()); }}><label><span className="sr-only">Search subscriptions</span><input aria-label="Search subscriptions" placeholder="Search hospital or organization" value={subscriptionSearchInput} onChange={(event) => setSubscriptionSearchInput(event.target.value)} maxLength={100}/></label><button type="submit">Search</button></form><select aria-label="Filter subscription status" value={subscriptionStatus} onChange={(event) => { setSubscriptionStatus(event.target.value); setSubscriptionPage(1); }}><option value="">All subscription statuses</option><option value="TRIALING">Trialing</option><option value="ACTIVE">Active</option><option value="PAST_DUE">Past due</option><option value="CANCELED">Canceled</option><option value="EXPIRED">Expired</option></select></div></div>
        {subscriptionError ? <p className="platform-audit-error" role="status">{subscriptionError}</p> : subscriptions.length === 0 ? <div className="platform-empty"><Building2 size={25}/><h3>No subscriptions in this view</h3><p>Assigned hospital plans and their current periods will appear here.</p></div> : <div className="platform-hospital-table-wrap"><table className="platform-hospital-table"><thead><tr><th>HOSPITAL</th><th>ORGANIZATION</th><th>PLAN</th><th>STATUS</th><th>BRANCHES</th><th>MEMBERS</th><th>CURRENT PERIOD END</th></tr></thead><tbody>{subscriptions.map((subscription) => <tr key={subscription.id}><td><b>{subscription.hospital.name}</b><small>{subscription.hospital.slug}</small></td><td>{subscription.hospital.organization.name}</td><td>{subscription.plan.name}{!subscription.plan.active ? " · inactive plan" : ""}</td><td><span className={`platform-status status-${subscription.status.toLowerCase()}`}>{subscription.status.replaceAll("_", " ")}</span></td><td>{subscription.hospital._count.branches}</td><td>{subscription.hospital._count.memberships}</td><td><time dateTime={subscription.currentPeriodEnd}>{new Date(subscription.currentPeriodEnd).toLocaleDateString("en-IN", { dateStyle: "medium" })}</time></td></tr>)}</tbody></table></div>}
        {!subscriptionError && subscriptionPagination.pages > 1 && <div className="platform-audit-pagination"><span>Page {subscriptionPagination.page} of {subscriptionPagination.pages} · {subscriptionPagination.total.toLocaleString()} subscriptions</span><div><button type="button" disabled={subscriptionPage <= 1} onClick={() => setSubscriptionPage((page) => page - 1)}>Previous</button><button type="button" disabled={subscriptionPage >= subscriptionPagination.pages} onClick={() => setSubscriptionPage((page) => page + 1)}>Next</button></div></div>}
      </section>
      <div className="platform-list-heading"><div><h2>Hospital applications</h2><p>Only verified applications appear in review queues.</p></div><select aria-label="Filter application status" value={selectedStatus} onChange={(event) => setSelectedStatus(event.target.value)}><option value="PENDING_REVIEW">Awaiting review</option><option value="NEEDS_INFORMATION">Needs information</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option><option value="EMAIL_PENDING">Email pending</option></select></div>
      {notice && <p className="platform-notice" role="status">{notice}</p>}{error && <p className="onboarding-error" role="alert">{error}</p>}
      {applications.length === 0 ? <div className="platform-empty"><Building2 size={25}/><h3>No applications in this queue</h3><p>Applications will appear here after the official email address is verified.</p></div> : <div className="platform-applications">{applications.map((item) => {
        const id = String(item.id); const applicationStatus = String(item.status); const hospitalName = String(item.hospitalName); const delivery = (item.createdHospital as { invitations?: Array<{ id: string; deliveryStatus: string }> } | null)?.invitations?.[0];
        return <article className="platform-application" key={id}><div className="platform-application-top"><div><span className={`platform-status status-${applicationStatus.toLowerCase()}`}>{applicationStatus.replaceAll("_", " ")}</span><h3>{hospitalName}</h3><p>{String(item.hospitalType)} · {String(item.city)}, {String(item.state)}, {String(item.country)}</p></div><small>Submitted {new Date(String(item.createdAt)).toLocaleDateString()}</small></div>
          <div className="platform-detail-grid"><span><b>Official email</b>{String(item.officialEmail)}</span><span><b>Contact</b>{String(item.contactPhone)}</span><span><b>Beds / branches</b>{String(item.bedCount)} / {String(item.branchCount)}</span><span><b>Proposed admin</b>{String(item.proposedAdminName)} · {String(item.proposedAdminEmail)}</span><span><b>Representative</b>{String(item.representativeName)} · {String(item.representativeDesignation)}</span><span className="platform-address"><b>Address</b>{String(item.streetAddress)}, {String(item.postalCode)}</span></div>
          {applicationStatus === "PENDING_REVIEW" && <div className="platform-actions"><button disabled={Boolean(busyId)} onClick={() => void action(`/api/v1/platform/applications/${id}/decision`, { decision: "APPROVE" }, "Hospital provisioned. The admin invitation email status is shown below.")}>Approve and send admin invite</button><button className="secondary" disabled={Boolean(busyId)} onClick={() => { const reason = window.prompt("Reason to request more information (at least 10 characters):"); if (reason) void action(`/api/v1/platform/applications/${id}/decision`, { decision: "REQUEST_INFORMATION", reason }, "Information request recorded."); }}>Request information</button><button className="danger" disabled={Boolean(busyId)} onClick={() => { const reason = window.prompt("Reason for rejection (at least 10 characters):"); if (reason) void action(`/api/v1/platform/applications/${id}/decision`, { decision: "REJECT", reason }, "Application rejected."); }}>Reject</button></div>}
          {applicationStatus === "APPROVED" && delivery && <div className="platform-invitation-status"><span>Admin invitation delivery: <b>{delivery.deliveryStatus}</b></span>{delivery.deliveryStatus !== "SENT" && <button disabled={Boolean(busyId)} onClick={() => void action(`/api/v1/platform/invitations/${delivery.id}/resend`, {}, "Invitation resend attempt completed.")}>Resend invitation</button>}</div>}
          {applicationStatus === "NEEDS_INFORMATION" && typeof item.reviewReason === "string" && <p className="platform-review-reason">Requested: {item.reviewReason}</p>}
        </article>;
      })}</div>}
      <section className="platform-audit" aria-labelledby="platform-audit-title">
        <div className="platform-list-heading"><div><h2 id="platform-audit-title">Security and platform activity</h2><p>Recent account and hospital administration events. Patient-directory access trails stay within the hospital tenant.</p></div><div className="platform-audit-tools"><label><span className="sr-only">Filter audit events by action</span><select aria-label="Filter audit activity" value={auditAction} onChange={(event) => { setAuditAction(event.target.value); setAuditPage(1); }}><option value="">All activity</option><option value="auth.login_succeeded">Successful sign-ins</option><option value="auth.login_failed">Failed sign-ins</option><option value="auth.password_reset_completed">Password resets</option><option value="hospital.application_approved">Hospital approvals</option><option value="hospital.application_rejected">Hospital rejections</option><option value="hospital.suspended">Hospital suspensions</option><option value="hospital.reactivated">Hospital reactivations</option></select></label><button type="button" onClick={() => void load()}>Refresh activity</button></div></div>
        {auditError ? <p className="platform-audit-error" role="status">{auditError}</p> : auditEvents.length === 0 ? <div className="platform-empty"><ShieldCheck size={23}/><h3>No activity in this view</h3><p>Recorded security and platform actions will appear here.</p></div> : <div className="platform-audit-table-wrap"><table className="platform-audit-table"><thead><tr><th>EVENT</th><th>ACTOR</th><th>ORGANIZATION</th><th>RESOURCE</th><th>TIME</th></tr></thead><tbody>{auditEvents.map((event) => <tr key={event.id}><td><code>{event.action}</code></td><td>{event.actor?.displayName ?? "System or unknown account"}</td><td>{event.organization?.name ?? "Platform"}</td><td>{event.resourceType.replaceAll("_", " ")}{event.resourceId ? <small>{event.resourceId}</small> : null}</td><td><time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</time></td></tr>)}</tbody></table></div>}
        {!auditError && auditPagination.pages > 1 && <div className="platform-audit-pagination"><span>Page {auditPagination.page} of {auditPagination.pages} · {auditPagination.total.toLocaleString()} events</span><div><button type="button" disabled={auditPage <= 1} onClick={() => setAuditPage((page) => page - 1)}>Previous</button><button type="button" disabled={auditPage >= auditPagination.pages} onClick={() => setAuditPage((page) => page + 1)}>Next</button></div></div>}
      </section>
      <p className="platform-footnote">This console supports onboarding and read-only subscription operations. Payment actions, patient records, clinical workflows, and file storage are not exposed here.</p>
    </section>
  </main>;
}

function Field({ label, name, type = "text", value, onChange, required, maxLength, min, max, placeholder }: { label: string; name: string; type?: string; value: string; onChange: (value: string) => void; required?: boolean; maxLength?: number; min?: number; max?: number; placeholder?: string }) {
  return <label className="onboarding-field"><span>{label}</span><input name={name} type={type} value={value} onChange={(event) => onChange(event.target.value)} required={required} maxLength={maxLength} min={min} max={max} placeholder={placeholder}/></label>;
}

function OnboardingFrame({ kicker, title, description, children }: { kicker: string; title: string; description: string; children: ReactNode }) {
  return <main className="onboarding-page"><header className="onboarding-header"><Link href="/site"><BrandMark/></Link><Link className="onboarding-signin" href="/login">Sign in <ArrowRight size={14}/></Link></header><section className="onboarding-card"><span className="auth-eyebrow"><HeartPulse size={14}/> {kicker}</span><h1>{title}</h1><p className="onboarding-description">{description}</p>{children}<footer className="onboarding-footer">JR Xpert HMS <span>Better Care. Smarter Management. Healthier Tomorrow.</span></footer></section></main>;
}

function metric(label: string, value: unknown) {
  return <article className="platform-metric" key={label}><span>{label}</span><strong>{typeof value === "number" ? value.toLocaleString() : "—"}</strong></article>;
}
