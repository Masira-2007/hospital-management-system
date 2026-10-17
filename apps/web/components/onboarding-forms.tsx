"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, BadgeCheck, Building2, Eye, EyeOff, HeartPulse, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";

type ApiResult = { message?: string; authenticatorSecret?: string; authenticatorUri?: string; nextStep?: string };

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
      setSecret(data?.authenticatorSecret ?? ""); setAuthenticatorUri(data?.authenticatorUri ?? ""); setPrepared(true); setPassword(""); setConfirm("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Secure setup is unavailable. Please try again."); }
    finally { setBusy(false); }
  }

  async function complete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const path = platform ? "/api/v1/platform/bootstrap/complete" : "/api/v1/hospital-invitations/complete";
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, mfaCode }) });
      const data = await response.json().catch(() => null) as ApiResult | null;
      if (!response.ok) throw new Error(data?.message ?? "The authenticator code was not accepted.");
      setSuccess(true); setSecret(""); setAuthenticatorUri("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Secure setup could not be completed."); }
    finally { setBusy(false); }
  }

  async function acceptWithExistingAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const login = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ email: existingEmail, password: existingPassword, mode: "HOSPITAL", rememberMe: false, mfaCode: existingMfaCode }),
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

  if (success) return <OnboardingFrame kicker="ACCOUNT SECURITY" title={existingMode ? "Invitation accepted" : "Your account is ready"} description={existingMode ? "This account now has authorized access to the hospital workspace." : platform ? "First administrator setup is complete. Sign in with your password and authenticator code." : "Hospital administrator setup is complete. Sign in with your password and authenticator code."}>
    <div className="onboarding-success"><BadgeCheck size={22}/><Link href={existingMode ? "/workspace" : platform ? "/super-admin/login" : "/login"}>{existingMode ? "Open workspace" : "Sign in securely"} <ArrowRight size={15}/></Link></div>
  </OnboardingFrame>;

  return <OnboardingFrame kicker={platform ? "FIRST PLATFORM ADMINISTRATOR" : "HOSPITAL ADMIN INVITATION"} title={platform ? "Secure your administrator account" : existingMode ? "Accept your hospital invitation" : "Set up your hospital account"} description={!token ? "This one-time setup link is missing or invalid. Open the complete link from the invitation email." : existingMode ? "Sign in with the invited email and your authenticator to add this hospital to your existing account." : prepared ? "Add the secret to an authenticator app and confirm a current six-digit code." : "Create your password. You’ll also set up an authenticator before the account is activated."}>
    {!token ? <div className="onboarding-state error"><Mail size={22}/><Link href={platform ? "/super-admin/login" : "/login"}>Return to sign in</Link></div> : prepared ? <form className="onboarding-form" onSubmit={complete}>
      <div className="onboarding-secret"><strong>Authenticator setup key</strong><code>{secret}</code>{authenticatorUri && <a href={authenticatorUri}>Open in an authenticator app</a>}<small>Keep this private. It is shown once; save it in your authenticator before continuing.</small></div>
      <label className="onboarding-field"><span>6-digit authenticator code</span><input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))} required/></label>
      {error && <p className="onboarding-error" role="alert">{error}</p>}
      <button className="onboarding-submit" disabled={busy}>{busy ? "Confirming…" : "Confirm and activate account"}<ShieldCheck size={16}/></button>
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
      <button className="onboarding-submit" disabled={busy}>{busy ? "Preparing secure setup…" : "Continue to authenticator setup"}<ArrowRight size={16}/></button>
      <p className="onboarding-note"><LockKeyhole size={15}/> Account access stays disabled until the authenticator code is confirmed.</p>
      </form>
    </>}
  </OnboardingFrame>;
}

export function PlatformDashboard({ identity }: { identity: { name: string; email: string } }) {
  const router = useRouter();
  const [applications, setApplications] = useState<Array<Record<string, unknown>>>([]);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [selectedStatus, setSelectedStatus] = useState("PENDING_REVIEW");
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setError("");
    try {
      const [overview, applicationList] = await Promise.all([
        fetch("/api/v1/platform/dashboard", { cache: "no-store" }),
        fetch(`/api/v1/platform/applications?status=${encodeURIComponent(selectedStatus)}`, { cache: "no-store" }),
      ]);
      if (overview.status === 401 || applicationList.status === 401) { router.replace("/super-admin/login"); return; }
      if (!overview.ok || !applicationList.ok) throw new Error("The secure platform service could not load the dashboard.");
      const data = await overview.json() as Record<string, unknown>;
      const list = await applicationList.json() as { applications?: Array<Record<string, unknown>> };
      setSummary(data); setApplications(list.applications ?? []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Dashboard unavailable."); }
  }

  useEffect(() => { void load(); }, [selectedStatus]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <div className="platform-metrics">{metric("Applications awaiting review", (summary?.applications as Record<string, number> | undefined)?.PENDING_REVIEW ?? 0)}{metric("Active hospitals", (summary?.hospitals as Record<string, number> | undefined)?.ACTIVE ?? 0)}{metric("Provisioning hospitals", (summary?.hospitals as Record<string, number> | undefined)?.PROVISIONING ?? 0)}{metric("Active accounts", summary?.activeUsers ?? 0)}</div>
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
      <p className="platform-footnote">This console supports hospital onboarding only. Patient, payment, clinical, file-storage, and subscription workflows are not exposed here.</p>
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
