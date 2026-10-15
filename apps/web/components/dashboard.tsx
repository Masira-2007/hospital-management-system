"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity, AlertCircle, ArrowDownRight, ArrowRight, ArrowUpRight, Bell, BedDouble,
  CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3,
  CreditCard, FlaskConical, Heart, LayoutDashboard, Menu, MoreHorizontal, Package,
  Plus, Search, Settings2, ShieldCheck, Stethoscope, Users, UserRound, X,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";

type Section = "Overview" | "Patients" | "Appointments" | "Doctors" | "Pharmacy" | "Laboratory" | "Billing" | "Inventory" | "Reports" | "Staff" | "Settings";

const nav: { label: Section; icon: typeof LayoutDashboard; group: string }[] = [
  { label: "Overview", icon: LayoutDashboard, group: "WORKSPACE" },
  { label: "Patients", icon: Users, group: "CARE" },
  { label: "Appointments", icon: CalendarDays, group: "CARE" },
  { label: "Doctors", icon: Stethoscope, group: "CARE" },
  { label: "Pharmacy", icon: Package, group: "OPERATIONS" },
  { label: "Laboratory", icon: FlaskConical, group: "OPERATIONS" },
  { label: "Billing", icon: CreditCard, group: "OPERATIONS" },
  { label: "Inventory", icon: BedDouble, group: "OPERATIONS" },
  { label: "Reports", icon: Activity, group: "INSIGHTS" },
  { label: "Staff", icon: UserRound, group: "ADMINISTRATION" },
  { label: "Settings", icon: Settings2, group: "ADMINISTRATION" },
];

const patients = [
  { initials: "RS", name: "Rahul Sharma", id: "P-1001", phone: "+91 98765 43210", age: "34 yrs", gender: "Male", status: "Active", color: "blue" },
  { initials: "AP", name: "Anita Patel", id: "P-1002", phone: "+91 91345 67890", age: "28 yrs", gender: "Female", status: "Active", color: "peach" },
  { initials: "SV", name: "Sneha Verma", id: "P-1003", phone: "+91 99887 76655", age: "46 yrs", gender: "Female", status: "Active", color: "lavender" },
  { initials: "AS", name: "Arjun Singh", id: "P-1004", phone: "+91 87654 32109", age: "52 yrs", gender: "Male", status: "Follow-up", color: "mint" },
  { initials: "PG", name: "Pooja Gupta", id: "P-1005", phone: "+91 90123 45678", age: "31 yrs", gender: "Female", status: "Active", color: "rose" },
  { initials: "NK", name: "Neha Kapoor", id: "P-1006", phone: "+91 98234 55678", age: "39 yrs", gender: "Female", status: "Active", color: "sky" },
];

const appointments = [
  { time: "09:00 AM", name: "Rahul Sharma", detail: "General Medicine · OPD 101", doctor: "Dr. Priya Sharma", status: "Checked in", initials: "RS", color: "blue" },
  { time: "09:30 AM", name: "Anita Patel", detail: "Cardiology · OPD 204", doctor: "Dr. Mehul Shah", status: "Confirmed", initials: "AP", color: "peach" },
  { time: "10:00 AM", name: "Sneha Verma", detail: "Orthopedics · OPD 106", doctor: "Dr. Karan Desai", status: "Waiting", initials: "SV", color: "lavender" },
  { time: "10:30 AM", name: "Arjun Singh", detail: "General Medicine · OPD 101", doctor: "Dr. Priya Sharma", status: "Confirmed", initials: "AS", color: "mint" },
];

const activities = [
  { icon: UserRound, text: "New patient registered", sub: "Rahul Sharma · 08:42 AM", color: "teal" },
  { icon: CalendarDays, text: "Appointment booked", sub: "Anita Patel · 08:36 AM", color: "blue" },
  { icon: CreditCard, text: "Payment received", sub: "₹ 2,000 · 08:22 AM", color: "green" },
  { icon: FlaskConical, text: "Lab report generated", sub: "Daily OPD report · 08:10 AM", color: "purple" },
];

function LogoAvatar({ initials, color }: { initials: string; color: string }) {
  return <span className={`avatar avatar-${color}`}>{initials}</span>;
}

function MetricCard({ icon: Icon, label, value, change, tone, trend = "up" }: { icon: typeof Users; label: string; value: string; change: string; tone: string; trend?: "up" | "down" }) {
  const Trend = trend === "up" ? ArrowUpRight : ArrowDownRight;
  return (
    <article className="metric-card card">
      <div className={`metric-icon ${tone}`}><Icon size={19} strokeWidth={1.9} /></div>
      <div className="metric-data"><span className="metric-label">{label}</span><strong>{value}</strong>
        <span className={`metric-change ${trend}`}><Trend size={14} strokeWidth={2.3} />{change}</span>
      </div>
      <button className="icon-button metric-more" aria-label={`More about ${label}`}><MoreHorizontal size={18} /></button>
    </article>
  );
}

function DashboardHome({ setSection, openNotice }: { setSection: (value: Section) => void; openNotice: (title: string, text: string) => void }) {
  return <>
    <div className="welcome-row">
      <div><p className="eyebrow">WEDNESDAY, OCTOBER 15, 2026 <span className="eyebrow-dot" /> AHMEDABAD, INDIA</p><h1>Good morning, Dr. Priya <span className="wave">✦</span></h1><p className="welcome-copy">Here’s what’s happening at your hospital today.</p></div>
      <button className="button button-outline date-button"><CalendarDays size={16} />Today, Oct 15<ChevronDown size={15} /></button>
    </div>
    <div className="metric-grid">
      <MetricCard icon={Users} label="Total patients" value="2,486" change="12% vs last month" tone="blue" />
      <MetricCard icon={CalendarDays} label="Today's appointments" value="32" change="8% vs yesterday" tone="teal" />
      <MetricCard icon={Stethoscope} label="Available doctors" value="18" change="2 on leave today" tone="violet" trend="down" />
      <MetricCard icon={CreditCard} label="Today's revenue" value="₹ 1,24,500" change="15% vs last week" tone="green" />
    </div>
    <div className="overview-grid">
      <section className="card chart-card">
        <div className="card-heading"><div><h2>Patient visits overview</h2><p>Daily visits across your hospital</p></div><div className="chart-legend"><span><i className="legend-dot dot-blue" />This week</span><span><i className="legend-dot dot-mint" />Last week</span><button className="icon-button" aria-label="More chart options"><MoreHorizontal size={19} /></button></div></div>
        <div className="chart-wrap" role="img" aria-label="Line chart showing patient visits increasing through the week">
          <div className="chart-y-labels"><span>200</span><span>150</span><span>100</span><span>50</span><span>0</span></div>
          <svg className="line-chart" viewBox="0 0 680 190" preserveAspectRatio="none" aria-hidden="true">
            <defs><linearGradient id="areaBlue" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#2780ed" stopOpacity=".14"/><stop offset="1" stopColor="#2780ed" stopOpacity="0"/></linearGradient></defs>
            <path className="grid-line" d="M0 13H680M0 53H680M0 93H680M0 133H680M0 173H680" />
            <path d="M0 147 C28 143 32 113 70 124 S111 141 142 114 S192 130 229 99 S281 112 320 85 S375 104 413 78 S458 88 499 61 S541 93 581 51 S630 55 680 26 L680 173 L0 173Z" fill="url(#areaBlue)" />
            <path d="M0 147 C28 143 32 113 70 124 S111 141 142 114 S192 130 229 99 S281 112 320 85 S375 104 413 78 S458 88 499 61 S541 93 581 51 S630 55 680 26" fill="none" stroke="#2d7fea" strokeWidth="3" strokeLinecap="round" />
            <path d="M0 158 C31 148 47 152 72 146 S110 155 142 139 S188 147 224 129 S274 136 320 118 S371 131 413 108 S459 120 499 104 S548 114 581 94 S633 101 680 80" fill="none" stroke="#16b8a6" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="680" cy="26" r="5" fill="#fff" stroke="#2d7fea" strokeWidth="3" />
          </svg>
          <div className="chart-x-labels"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div>
        </div>
      </section>
      <section className="card department-card">
        <div className="card-heading"><div><h2>Department-wise patients</h2><p>Visits by department this week</p></div><button className="icon-button" aria-label="More department options"><MoreHorizontal size={19} /></button></div>
        <div className="donut-wrap"><div className="donut"><div className="donut-center"><strong>248</strong><span>Total visits</span></div></div><ul className="department-legend"><li><i className="legend-dot dot-blue"/><span>General medicine</span><b>28%</b></li><li><i className="legend-dot dot-cyan"/><span>Cardiology</span><b>18%</b></li><li><i className="legend-dot dot-gold"/><span>Orthopedics</span><b>12%</b></li><li><i className="legend-dot dot-coral"/><span>Gynecology</span><b>10%</b></li><li><i className="legend-dot dot-violet"/><span>Pediatrics</span><b>8%</b></li><li><i className="legend-dot dot-gray"/><span>Other</span><b>24%</b></li></ul></div>
      </section>
      <section className="card activity-card">
        <div className="card-heading"><div><h2>Recent activity</h2><p>Latest updates across your hospital</p></div><button className="text-link" onClick={() => setSection("Reports")}>View all <ArrowRight size={14}/></button></div>
        <div className="activity-list">{activities.map(({ icon: Icon, text, sub, color }) => <div className="activity-item" key={text}><span className={`activity-icon ${color}`}><Icon size={16}/></span><span className="activity-copy"><b>{text}</b><small>{sub}</small></span><span className="activity-dot"/></div>)}</div>
      </section>
    </div>
    <section className="card appointments-card">
      <div className="card-heading appointment-heading"><div><h2>Today’s appointments <span className="count-badge">32</span></h2><p>Your next patient visits and check-ins</p></div><div className="heading-actions"><button className="button button-quiet" onClick={() => setSection("Appointments")}>View schedule <ArrowRight size={15}/></button><button className="button button-primary" onClick={() => openNotice("Appointment booking", "Appointment creation will be enabled after secure staff sign-in and the scheduling API are connected. This preview contains synthetic data only.")}><Plus size={16}/>New appointment</button></div></div>
      <div className="table-scroll"><table><thead><tr><th>TIME</th><th>PATIENT</th><th>DOCTOR</th><th>STATUS</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{appointments.map((appt) => <tr key={appt.time}><td className="time-cell"><Clock3 size={14}/>{appt.time}</td><td><div className="person-cell"><LogoAvatar initials={appt.initials} color={appt.color}/><span><b>{appt.name}</b><small>{appt.detail}</small></span></div></td><td>{appt.doctor}</td><td><span className={`status-pill ${appt.status.toLowerCase().replace(" ", "-")}`}><i/>{appt.status}</span></td><td><button className="icon-button row-menu" aria-label={`More actions for ${appt.name}`}><MoreHorizontal size={18}/></button></td></tr>)}</tbody></table></div>
      <div className="table-footer"><span>Showing <b>1–4</b> of <b>32</b> appointments</span><div className="pagination"><button aria-label="Previous page" disabled><ChevronLeft size={16}/></button><button className="selected">1</button><button>2</button><button>3</button><span>…</span><button>8</button><button aria-label="Next page"><ChevronRight size={16}/></button></div></div>
    </section>
    <div className="bottom-grid">
      <section className="card quick-card"><div className="card-heading"><div><h2>Quick actions</h2><p>Common tasks, right at your fingertips</p></div></div><div className="quick-actions"><button onClick={() => openNotice("Patient registration", "Secure patient registration is not yet connected. This preview does not save or transmit patient information.")}><span className="quick-icon blue"><Plus size={18}/></span><span><b>Register patient</b><small>Add a new patient record</small></span><ArrowRight size={15}/></button><button onClick={() => openNotice("Lab results", "The laboratory worklist and verified result workflow are part of the planned diagnostics module.")}><span className="quick-icon mint"><FlaskConical size={18}/></span><span><b>Review lab results</b><small>Check pending reports</small></span><ArrowRight size={15}/></button><button onClick={() => openNotice("Discharge planning", "Bed turnover and discharge coordination are planned. No clinical discharge decisions are made in this preview.")}><span className="quick-icon violet"><BedDouble size={18}/></span><span><b>Bed management</b><small>Check ward availability</small></span><ArrowRight size={15}/></button></div></section>
      <section className="care-note"><div className="care-note-mark"><Heart size={19} fill="currentColor"/></div><div><strong>Care that connects</strong><p>One clearer view of your hospital, so your team can focus on what matters most.</p><span>JR Xpert HMS · Better Care, every day</span></div><div className="care-note-spark">✳</div></section>
    </div>
    <p className="synthetic-note"><ShieldCheck size={14}/> Preview workspace uses fictional sample records. Do not enter real patient information.</p>
  </>;
}

function PatientsPage({ openNotice, initialQuery }: { openNotice: (title: string, text: string) => void; initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState("All patients");
  useEffect(() => setQuery(initialQuery), [initialQuery]);
  const filtered = patients.filter((patient) => `${patient.name} ${patient.id} ${patient.phone}`.toLowerCase().includes(query.toLowerCase()) && (filter === "All patients" || patient.status === filter));
  return <>
    <div className="welcome-row"><div><p className="eyebrow">CARE DIRECTORY</p><h1>Patients</h1><p className="welcome-copy">Search and review the patient directory.</p></div><button className="button button-primary" onClick={() => openNotice("Add patient", "Patient registration is unavailable in preview mode. The production workflow requires authorized staff access and the protected patient API.")}><Plus size={16}/>Add patient</button></div>
    <div className="metric-grid compact-metrics"><MetricCard icon={Users} label="Total patients" value="2,486" change="12% this month" tone="blue"/><MetricCard icon={UserRound} label="New this month" value="186" change="8% vs last month" tone="teal"/><MetricCard icon={Heart} label="Active patients" value="2,241" change="90% of total" tone="green"/><MetricCard icon={CalendarDays} label="Follow-ups due" value="24" change="6 due today" tone="violet"/></div>
    <section className="card directory-card"><div className="directory-toolbar"><div className="filter-tabs">{["All patients", "Active", "Follow-up"].map((tab) => <button className={filter === tab ? "active" : ""} key={tab} onClick={() => setFilter(tab)}>{tab}{tab === "All patients" && <span>2,486</span>}</button>)}</div><label className="table-search"><Search size={16}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, phone or ID…"/><kbd>⌘ K</kbd></label></div>
      <div className="table-scroll"><table><thead><tr><th>PATIENT NAME</th><th>PATIENT ID</th><th>PHONE</th><th>AGE / GENDER</th><th>STATUS</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{filtered.map((p) => <tr key={p.id}><td><div className="person-cell"><LogoAvatar initials={p.initials} color={p.color}/><span><b>{p.name}</b><small>Registered Oct 12, 2026</small></span></div></td><td className="id-cell">{p.id}</td><td>{p.phone}</td><td>{p.age}<span className="subtle-divider">·</span>{p.gender}</td><td><span className={`status-pill ${p.status === "Active" ? "confirmed" : "waiting"}`}><i/>{p.status}</span></td><td><button className="icon-button row-menu" aria-label={`More actions for ${p.name}`} onClick={() => openNotice("Patient record", "Opening a real patient chart requires an authenticated, authorized clinical session. This is a fictional preview record.")}><MoreHorizontal size={18}/></button></td></tr>)}</tbody></table>{filtered.length === 0 && <div className="empty-state"><Search size={22}/><b>No patients found</b><span>Try another name, phone number or patient ID.</span></div>}</div>
      <div className="table-footer"><span>Showing <b>{filtered.length ? 1 : 0}–{filtered.length}</b> of <b>2,486</b> patients <span className="demo-inline">· Sample data</span></span><div className="pagination"><button aria-label="Previous page" disabled><ChevronLeft size={16}/></button><button className="selected">1</button><button>2</button><button>3</button><span>…</span><button>249</button><button aria-label="Next page"><ChevronRight size={16}/></button></div></div>
    </section><p className="synthetic-note"><ShieldCheck size={14}/> Sample directory is fictional. Patient profiles and clinical records are not stored in this preview.</p>
  </>;
}

function AppointmentsPage({ openNotice }: { openNotice: (title: string, text: string) => void }) {
  return <><div className="welcome-row"><div><p className="eyebrow">SCHEDULE & QUEUE</p><h1>Appointments</h1><p className="welcome-copy">A shared view of today’s visits and waiting room.</p></div><button className="button button-primary" onClick={() => openNotice("Book appointment", "Online scheduling, availability checks and double-booking prevention are not connected in this preview.")}><Plus size={16}/>Book appointment</button></div><div className="metric-grid compact-metrics"><MetricCard icon={CalendarDays} label="Scheduled today" value="32" change="Across 6 departments" tone="blue"/><MetricCard icon={Check} label="Checked in" value="18" change="4 in waiting room" tone="green"/><MetricCard icon={Clock3} label="Average wait" value="18 min" change="5 min less than usual" tone="teal"/><MetricCard icon={AlertCircle} label="Follow-ups" value="12" change="Need confirmation" tone="violet"/></div><section className="card appointments-card schedule-card"><div className="card-heading"><div><h2>Today’s schedule</h2><p>Wednesday, October 15 · All departments</p></div><button className="button button-outline"><CalendarDays size={15}/>Day view<ChevronDown size={14}/></button></div><div className="table-scroll"><table><thead><tr><th>TIME</th><th>PATIENT</th><th>DOCTOR</th><th>DEPARTMENT</th><th>STATUS</th><th></th></tr></thead><tbody>{appointments.map((a) => <tr key={a.time}><td className="time-cell"><Clock3 size={14}/>{a.time}</td><td><div className="person-cell"><LogoAvatar initials={a.initials} color={a.color}/><span><b>{a.name}</b><small>{a.detail.split(" · ")[1]}</small></span></div></td><td>{a.doctor}</td><td>{a.detail.split(" · ")[0]}</td><td><span className={`status-pill ${a.status.toLowerCase().replace(" ", "-")}`}><i/>{a.status}</span></td><td><button className="icon-button row-menu" aria-label={`More actions for ${a.name}`} onClick={() => openNotice("Appointment details", "Appointment actions will be available after the authenticated scheduling API is connected.")}><MoreHorizontal size={18}/></button></td></tr>)}</tbody></table></div></section><p className="synthetic-note"><ShieldCheck size={14}/> Schedule shown is fictional preview data. No bookings can be created from this screen.</p></>;
}

const moduleCopy: Record<Exclude<Section, "Overview" | "Patients" | "Appointments">, { eyebrow: string; title: string; description: string; icon: typeof LayoutDashboard; items: string[] }> = {
  Doctors: { eyebrow: "CARE TEAM", title: "Doctors & specialists", description: "The staff directory and clinician schedules are planned for a later product increment.", icon: Stethoscope, items: ["Credential and license tracking", "Department and branch access", "Availability and leave schedules"] },
  Pharmacy: { eyebrow: "MEDICINE MANAGEMENT", title: "Pharmacy", description: "Prescription verification, dispensing, batches and expiry controls are not implemented yet.", icon: Package, items: ["Batch and expiry traceability", "Verified dispensing workflow", "Stock reservations and transfers"] },
  Laboratory: { eyebrow: "DIAGNOSTICS", title: "Laboratory & diagnostics", description: "Lab orders, samples and reviewed results require a protected clinical workflow before use.", icon: FlaskConical, items: ["Order and specimen tracking", "Critical result acknowledgement", "Authorized report sign-off"] },
  Billing: { eyebrow: "FINANCE", title: "Billing & payments", description: "This preview does not process payments, create invoices or record financial transactions.", icon: CreditCard, items: ["Estimates and itemized invoices", "Online provider adapters", "Offline payment audit trail"] },
  Inventory: { eyebrow: "SUPPLY & FACILITIES", title: "Inventory & beds", description: "Inventory movements, procurement approvals and ward occupancy need the transactional backend.", icon: BedDouble, items: ["Stock movement history", "Bed status and turnover", "Purchase approval workflow"] },
  Reports: { eyebrow: "INSIGHTS", title: "Reports & analytics", description: "Operational reporting will use tenant-scoped data and role-checked exports.", icon: Activity, items: ["Department and visit trends", "Finance and occupancy summaries", "Export permissions and audit log"] },
  Staff: { eyebrow: "PEOPLE & ACCESS", title: "Staff & roles", description: "Staff accounts, granular permissions and secure onboarding are not available yet.", icon: UserRound, items: ["Hospital-scoped memberships", "Role and permission management", "Credential expiry reminders"] },
  Settings: { eyebrow: "WORKSPACE", title: "Hospital settings", description: "Tenant branding, localization and integration settings will be managed here.", icon: Settings2, items: ["Hospital profile and branches", "Language, timezone and currency", "Integrations and audit history"] },
};

function PlannedPage({ section }: { section: Exclude<Section, "Overview" | "Patients" | "Appointments"> }) {
  const item = moduleCopy[section];
  const Icon = item.icon;
  return <><div className="welcome-row"><div><p className="eyebrow">{item.eyebrow}</p><h1>{item.title}</h1><p className="welcome-copy">{item.description}</p></div><span className="status-pill planned-pill"><i/>Planned</span></div><section className="card planned-card"><div className="planned-icon"><Icon size={25}/></div><div className="planned-content"><span className="planned-label">PRODUCT ROADMAP</span><h2>{item.title} module</h2><p>This module is part of the JR Xpert HMS specification. It is not connected to live hospital data and is not ready for clinical or financial use.</p><div className="planned-features">{item.items.map((feature) => <div key={feature}><span><Check size={14}/></span>{feature}</div>)}</div><span className="planned-disclaimer"><ShieldCheck size={15}/> Implementation status is tracked in the product specification.</span></div></section></>;
}

export default function Dashboard() {
  const [section, setSection] = useState<Section>("Overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notice, setNotice] = useState<{ title: string; text: string } | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const grouped = useMemo(() => nav.reduce<Record<string, typeof nav>>((acc, item) => { (acc[item.group] ??= []).push(item); return acc; }, {}), []);
  const openNotice = (title: string, text: string) => setNotice({ title, text });

  return <div className="app-shell">
    <aside className={`sidebar${sidebarOpen ? " sidebar-open" : ""}`}>
      <div className="sidebar-brand"><BrandMark compact/><span className="sidebar-brand-tag">HOSPITAL WORKSPACE</span><button className="icon-button sidebar-close" aria-label="Close menu" onClick={() => setSidebarOpen(false)}><X size={18}/></button></div>
      <div className="hospital-switcher"><div className="hospital-symbol">JR</div><span><b>JR Xpert General</b><small>Ahmedabad · Main branch</small></span><ChevronDown size={14}/></div>
      <nav aria-label="Main navigation">{Object.entries(grouped).map(([group, items]) => <div className="nav-group" key={group}><span className="nav-group-label">{group}</span>{items.map(({ label, icon: Icon }) => <button key={label} className={`nav-link${section === label ? " active" : ""}`} onClick={() => { setSection(label); setSidebarOpen(false); }}><Icon size={17} strokeWidth={1.8}/><span>{label}</span>{label === "Appointments" && <i className="nav-count">4</i>}</button>)}</div>)}</nav>
      <div className="sidebar-spacer"/><div className="sidebar-help"><span className="help-icon"><CircleHelp size={17}/></span><span><b>Need a hand?</b><small>Help center & support</small></span><ArrowRight size={14}/></div><div className="sidebar-user"><LogoAvatar initials="PS" color="teal"/><span><b>Dr. Priya Sharma</b><small>Hospital admin · Preview</small></span><button className="icon-button" aria-label="Profile options" onClick={() => setProfileOpen((v) => !v)}><MoreHorizontal size={18}/></button>{profileOpen && <div className="profile-menu"><b>Preview profile</b><span>No account is signed in.</span><button onClick={() => openNotice("Secure sign-in", "Authentication, staff membership checks and session management must be implemented before this workspace can be used with real hospital data.")}>About secure access</button></div>}</div>
      <div className="sidebar-footer"><span>JR XPERT HMS <b>·</b> PREVIEW</span><button aria-label="About this preview" onClick={() => openNotice("Preview workspace", "This is a visual product increment with synthetic sample data. It is not connected to authentication, a database, or live hospital workflows.")}><CircleHelp size={14}/></button></div>
    </aside>
    {sidebarOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}/>}
    <main className="main-area">
      <header className="topbar"><button className="icon-button mobile-menu" aria-label="Open menu" onClick={() => setSidebarOpen(true)}><Menu size={20}/></button><div className="breadcrumbs"><span>JR Xpert General</span><ChevronRight size={14}/><b>{section}</b></div><label className="global-search"><Search size={16}/><input aria-label="Search this preview" placeholder="Search patients, doctors, appointments…" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && search.trim()) { setSection("Patients"); setSidebarOpen(false); } }}/><kbd>⌘ K</kbd></label><div className="topbar-actions"><span className="preview-chip"><i/>Preview data</span><div className="notifications-wrap"><button className="icon-button notification-button" aria-label="Notifications" onClick={() => setNotificationsOpen((v) => !v)}><Bell size={18}/><i/></button>{notificationsOpen && <div className="notification-popover"><b>Notifications</b><p><Check size={15}/> You’re all caught up.</p><small>Preview workspace notifications only.</small></div>}</div><span className="topbar-divider"/><button className="profile-button" onClick={() => setProfileOpen((v) => !v)}><LogoAvatar initials="PS" color="teal"/><span><b>Dr. Priya Sharma</b><small>Hospital admin</small></span><ChevronDown size={15}/></button></div></header>
      <div className="content-area">{section === "Overview" ? <DashboardHome setSection={setSection} openNotice={openNotice}/> : section === "Patients" ? <PatientsPage openNotice={openNotice} initialQuery={search}/> : section === "Appointments" ? <AppointmentsPage openNotice={openNotice}/> : <PlannedPage section={section}/>}</div>
      <footer className="main-footer"><span>© 2026 JR Xpert HMS</span><span>Better Care <i/> Smarter Management <i/> Healthier Tomorrow</span><button onClick={() => openNotice("About this workspace", "JR Xpert HMS follows the visual identity shown in the reference. All records on this page are fictional sample data.")}>About preview <ArrowRight size={13}/></button></footer>
    </main>
    {notice && <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setNotice(null); }}><section className="notice-modal" role="dialog" aria-modal="true" aria-labelledby="notice-title"><button className="icon-button modal-close" aria-label="Close dialog" onClick={() => setNotice(null)}><X size={18}/></button><span className="modal-mark"><ShieldCheck size={21}/></span><span className="modal-kicker">JR XPERT HMS · PREVIEW</span><h2 id="notice-title">{notice.title}</h2><p>{notice.text}</p><button className="button button-primary modal-ok" onClick={() => setNotice(null)}>Understood <Check size={15}/></button></section></div>}
  </div>;
}
