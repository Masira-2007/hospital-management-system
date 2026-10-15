# JR Xpert HMS product source of truth

**Company:** JR Xpert
**Product:** JR Xpert Hospital Management System
**Tagline:** Better Care. Smarter Management. Healthier Tomorrow.
**Reference:** User-supplied JR Xpert HMS collage (marketing page, login screen, admin dashboards, patient directory, billing and mobile preview). Use it as visual direction and create original JR Xpert assets.

This document tracks the user-provided master prompt. It is a scope record, not a claim that listed work is implemented. Status: **not started** unless explicitly marked in the increment table. The pasted prompt received by this workspace stops in section 19.E at “Medicine Expiry and St”; its remaining text and later requirements were not present, so they must be added when provided.

## Identity and visual system

- Product/company identity: JR Xpert HMS / JR Xpert.
- Tagline: Better Care. Smarter Management. Healthier Tomorrow.
- Palette: navy `#073763`, deep navy `#062B49`, teal `#079DA7`, cyan `#14B8D4`, background `#F2F8FC`, white surfaces, primary text `#183A5A`, secondary text `#6C8297`, success `#159B79`, warning `#E8A23B`, error `#D9485F`.
- Original vector mark combines a medical cross and caregiving symbol. Apply the identity consistently across all user-facing outputs.
- Reusable responsive, accessible design system; light and optional dark themes; keyboard/screen-reader support; loading, empty, error, success and offline states; English, Hindi and Gujarati localization architecture.

## Product scope and status

| Area | Requested scope | Status in this increment |
|---|---|---|
| Public website | Marketing site, product pages, calls to action and hospital imagery | Branded marketing page with product preview; no lead capture or production auth |
| Staff web application | Responsive, role-specific hospital workspace | Visual dashboard and fictional preview only |
| Patient portal | Secure patient access, scheduling, reports, bills, consent and dependents | Not started |
| Mobile apps | Android/iOS Expo app, secure storage, biometrics, push and offline state | Not started |
| Super Admin SaaS | Tenant onboarding, subscriptions, usage, system health and support | Not started |
| Multi-tenant core | Organizations, hospital groups, hospitals, branches, locations, tenant settings and subscriptions | Initial Prisma organization/hospital/branch/membership contract only; isolation not enforced yet |
| Authentication and identity | Verification, recovery, secure hashing, MFA, sessions, SSO, rate limits and device management | Not started |
| Permissions and audit | Granular role/attribute access, scope, expiry, revocation, break-glass and reviewable audit | Role names and audit record shape only; enforcement not started |
| Patient EMR/EHR | Registration, MRN, history, allergies, encounters, medication, notes, results, consent, signatures, amendments and exports | Fictional directory preview only; no patient API or persistent data |
| Appointments and queues | Availability, booking, conflict prevention, walk-ins, tokens, queue, reminders and no-shows | Fictional schedule preview only; no booking API |
| Doctor/nurse workflow | Clinical documentation, medication administration, observations, handover and escalation | Not started |
| OPD/IPD/ICU/OT/emergency | Admissions, beds, transfers, triage, surgery, discharge coordination and ambulance | Not started |
| Pharmacy | Catalog, lots, prescribing, dispensing, purchasing, expiry, recall, stock and reconciliation | Not started |
| Diagnostics | Lab orders, specimens, QC, critical-result escalation, review/sign-off, imaging and DICOM/PACS adapter | Not started |
| Billing and finance | Estimates, invoices, GST, payments, refunds, claims, accounting and reconciliation | Not started; no money movement |
| Insurance and claims | Eligibility, pre-authorization, submission, queries, denials and settlement | Not started; no simulated insurer approvals |
| Inventory and equipment | Procurement, suppliers, movement ledger, stock control, equipment and maintenance | Not started |
| HR and payroll | Staff, credentials, shifts, attendance, leave and jurisdiction-configured payroll | Not started |
| Communication | Telemedicine, notifications, reminders and patient support | Not started |
| AI/operations intelligence | Approved-data assistant and operational workflows with human review | Not started; prompt content is truncated during section 19.E |
| Integrations and API | Versioned REST/OpenAPI, realtime, gateways, analyzers, PACS, insurer and accounting adapters | Health endpoint and OpenAPI shell only |
| Infrastructure | PostgreSQL, Prisma migrations, Redis/jobs, private S3-compatible files, Docker, CI/CD, monitoring, backup and environments | Compose foundation for PostgreSQL/Redis; no production operations |
| Quality and documentation | Unit, integration, API, end-to-end, threat/privacy review and deployment guides | One API liveness test; no clinical/security certification |

## Required architecture and product constraints

- Prefer a modular monolith with clean domain boundaries and an option to separate high-load modules later.
- Intended stack: Next.js, React and TypeScript; Tailwind CSS and reusable accessible components; NestJS/TypeScript; PostgreSQL with Prisma; Redis and a reliable job queue; versioned REST/OpenAPI; realtime only where appropriate; React Native/Expo; private S3-compatible object storage; Docker and separate development, staging and production environments.
- Never authorize a tenant by trusting a client-supplied tenant ID. Resolve tenant context from authenticated membership and enforce it through every data-access path; assess PostgreSQL row-level security as defense in depth.
- Platform Super Admin must not automatically receive access to patient records. Any emergency access/impersonation requires explicit purpose, time limits, disclosure, audit and alerting.
- Do not silently overwrite signed clinical records. Preserve authorship, signatures, timestamps, amendments and history.
- Verify payments server-side and provider webhooks cryptographically; use idempotency; distinguish payment, capture, settlement, refund and reconciliation. Do not store raw card data. Manual payments remain explicitly offline and auditable.
- Never fabricate results, claim real insurer approvals, release unverified results, or automate clinical decisions. AI assists qualified staff with human review and approved information.
- Keep real patient data out of this preview. No clinical/financial write APIs should be exposed before authentication, tenant isolation, authorization, audit, privacy and safety controls are implemented and reviewed.

## Increment history

### 0.1.0 — Foundation preview

- Added branded responsive dashboard, synthetic patient directory and appointment views, and planned-module placeholders.
- Added a public marketing page introducing JR Xpert HMS and linking to the explicitly labeled workspace preview.
- Added Next.js/React web workspace and Tailwind CSS pipeline.
- Added a NestJS API shell with `/api/v1/health`, OpenAPI UI and one liveness test.
- Added initial Prisma/PostgreSQL domain contract and local PostgreSQL/Redis Compose services.
- No production readiness claim. Authentication, data access, tenant enforcement and live integrations remain unimplemented.
