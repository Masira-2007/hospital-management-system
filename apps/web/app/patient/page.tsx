import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, CalendarDays, HeartPulse, Hospital, ShieldCheck, UserRound } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { PatientLogoutButton } from "@/components/patient-logout";
import { loadPatientPortalData } from "@/lib/patient-portal-data";
import "../auth.css";
import "./patient.css";

export const metadata: Metadata = { title: "Patient portal | JR Xpert HMS", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

function PatientPortalState({ title, message, action }: { title: string; message: string; action?: { label: string; href: string } }) {
  return <main className="patient-page"><section className="patient-state-card">
    <BrandMark/>
    <span className="patient-state-icon"><ShieldCheck size={22}/></span>
    <h1>{title}</h1><p>{message}</p>
    {action && <Link className="patient-button patient-button-primary" href={action.href}>{action.label}</Link>}
  </section></main>;
}

function formatDate(value: string | null): string {
  if (!value) return "Not provided";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
}

export default async function PatientPage() {
  const cookieName = process.env.NODE_ENV === "production" ? "__Host-jrxpert_session" : "jrxpert_session";
  const cookieStore = await cookies();
  const token = cookieStore.get(cookieName)?.value;
  const result = await loadPatientPortalData(token, { cookieName });
  if (result.state === "login") redirect("/login");
  if (result.state === "select-workspace") return <PatientPortalState title="Choose your hospital" message="Select your patient membership from your authorized workspaces, then return to the patient portal." action={{ label: "Choose workspace", href: "/workspace" }}/>;
  if (result.state === "denied") return <PatientPortalState title="Patient access not found" message="This account has no active patient workspace. Contact your hospital if you believe this is incorrect." action={{ label: "Return to sign in", href: "/login" }}/>;
  if (result.state === "unavailable") return <PatientPortalState title="Patient portal unavailable" message="We couldn’t load your authorized patient information. Please try again shortly." action={{ label: "Try again", href: "/patient" }}/>;

  const { data } = result;
  return <main className="patient-page">
    <header className="patient-header"><BrandMark/><div className="patient-header-actions"><Link className="patient-back-link" href="/workspace"><ArrowLeft size={15}/> Workspaces</Link><PatientLogoutButton/></div></header>
    <section className="patient-main">
      <div className="patient-welcome"><div><span className="patient-eyebrow"><UserRound size={14}/> PATIENT PORTAL</span><h1>Hello, {data.user.displayName}</h1><p>{data.user.email}</p></div>
        <div className="patient-hospital"><span><Hospital size={17}/></span><div><small>YOUR HOSPITAL</small><strong>{data.hospitalName}</strong><p>{data.organizationName}{data.branchName ? ` · ${data.branchName}` : ""}</p></div></div>
      </div>
      <div className="patient-privacy-note"><ShieldCheck size={17}/><p>Only patient records explicitly shared with this signed-in account appear here. Contact your hospital if a record is missing.</p></div>
      <section className="patient-records-section"><div className="patient-section-heading"><div><h2>Linked patient records</h2><p>{data.patients.length} {data.patients.length === 1 ? "record" : "records"} available in this hospital workspace</p></div><span><CalendarDays size={15}/> Patient access</span></div>
        {data.patients.length ? <div className="patient-record-grid">{data.patients.map(({ id, mrn, firstName, lastName, dateOfBirth, relationship }) => <article className="patient-record-card" key={id}>
          <div className="patient-record-icon"><UserRound size={18}/></div><div className="patient-record-heading"><h3>{firstName} {lastName}</h3><span>{relationship.replaceAll("_", " ")}</span></div>
          <dl><div><dt>Patient number</dt><dd>{mrn}</dd></div><div><dt>Date of birth</dt><dd>{formatDate(dateOfBirth)}</dd></div></dl>
        </article>)}</div> : <div className="patient-empty"><span><HeartPulse size={21}/></span><strong>No linked patient records yet</strong><p>Your hospital has not shared a patient record with this account. Contact the hospital for help.</p></div>}
      </section>
      <div className="patient-limits-note"><strong>Available information</strong><p>This portal currently shows linked patient identity details only. Clinical notes, test results, prescriptions, appointments, and bills are not available in this release.</p></div>
    </section>
    <footer className="patient-footer"><span>JR Xpert HMS</span><span>Better Care. Smarter Management. Healthier Tomorrow.</span></footer>
  </main>;
}
