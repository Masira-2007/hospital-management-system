# JR Xpert HMS product source of truth

**Company:** JR Xpert
**Product:** JR Xpert Hospital Management System
**Tagline:** Better Care. Smarter Management. Healthier Tomorrow.
**Reference:** User-supplied JR Xpert HMS collage plus the separately supplied JR Xpert HMS logo. Use the collage as visual direction and the supplied logo image as the brand asset.

This document tracks the user-provided master prompt. It is a scope record, not a claim that listed work is implemented. Status: **not started** unless explicitly marked in the increment table. The pasted prompt received by this workspace stops in section 19.E at “Medicine Expiry and St”; its remaining text and later requirements were not present, so they must be added when provided.

## Identity and visual system

- Product/company identity: JR Xpert HMS / JR Xpert.
- Tagline: Better Care. Smarter Management. Healthier Tomorrow.
- Palette: navy `#073763`, deep navy `#062B49`, teal `#079DA7`, cyan `#14B8D4`, background `#F2F8FC`, white surfaces, primary text `#183A5A`, secondary text `#6C8297`, success `#159B79`, warning `#E8A23B`, error `#D9485F`.
- Use the supplied JR Xpert HMS logo, including its exact mark and wordmark, throughout the web product. The image is cropped from the user's provided source and reused by the shared brand component.
- Do not display the unsupported “Trusted by 100+ Hospitals” badge or claim.
- Reusable responsive, accessible design system; light and optional dark themes; keyboard/screen-reader support; loading, empty, error, success and offline states; English, Hindi and Gujarati localization architecture.

## Product scope and status

| Area | Requested scope | Status in this increment |
|---|---|---|
| Public website | Marketing site, product pages, calls to action and hospital imagery | Branded marketing page with preview and hospital-application registration CTA; application email verification is implemented |
| Staff web application | Responsive, role-specific hospital workspace | Visual dashboard and fictional preview only |
| Patient portal | Secure patient access, scheduling, reports, bills, consent and dependents | Not started |
| Mobile apps | Android/iOS Expo app, secure storage, biometrics, push and offline state | Not started |
| Super Admin SaaS | Tenant onboarding, subscriptions, usage, system health and support | MFA-protected onboarding dashboard, application review/decision APIs, organization/hospital/branch provisioning, invitation resend/revocation, paginated platform audit summaries, and protected service-health/email-configuration indicators that expose no credentials or patient data. No subscription, usage-billing, support-ticket or patient-record admin workflows |
| Multi-tenant core | Organizations, hospital groups, hospitals, branches, locations, tenant settings and subscriptions | Organization/hospital/branch/membership, status, role, permission, subscription, settings and patient-access-grant schema; runtime membership-verified scope; transaction-scoped forced RLS for Patient reads/inserts and Appointment reads/inserts. Nine production migrations are applied; full two-tenant isolation proof against a non-production database remains outstanding |
| Authentication and identity | Verification, recovery, secure hashing, MFA, sessions, SSO, rate limits and device management | Login UI and same-origin BFF; hospital/patient/platform-admin mode filters; scrypt password verification; email-verified active-account check; TOTP required for privileged roles; 12-hour/30-day server-side sessions; password change, session listing/revocation, database throttling, one-use hashed reset tokens; email-verified application onboarding; hospital admin TOTP enrollment; emailed first-admin bootstrap. SSO/passkeys/device management remain unimplemented. Email requires provider setup |
| Permissions and audit | Granular role/attribute access, scope, expiry, revocation, break-glass and reviewable audit | Role/permission tables and `patient.directory.read` permission seed; active membership and tenant status checks; patient directory scope check; append-only audit triggers; MFA-protected, paginated platform audit summaries with metadata withheld and patient-directory access trails excluded. No fine-grained clinical ABAC, approvals or break-glass |
| Patient EMR/EHR | Registration, MRN, history, allergies, encounters, medication, notes, results, consent, signatures, amendments and exports | Authenticated tenant-scoped patient registration with server-generated MRN and a paginated directory read API. Registration accepts demographics only, is permission-gated, audited without demographic values, and protected by forced RLS and limited runtime grants. The web directory remains fictional preview data; no patient portal, clinical record writes or EMR/EHR workflows. Patient access grants are schema only |
| Appointments and queues | Availability, booking, conflict prevention, walk-ins, tokens, queue, reminders and no-shows | Added a bounded, tenant/branch-scoped appointment list and requested-booking API with role permissions, RLS, limited runtime INSERT columns, audit events and a database exclusion constraint for clinician overlap. No availability templates, reschedule/cancel/check-in/queue/reminder flows; web schedule remains fictional preview data |
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
| Integrations and API | Versioned REST/OpenAPI, realtime, gateways, analyzers, PACS, insurer and accounting adapters | Versioned NestJS health/auth/session/patient-directory/hospital-onboarding/platform APIs; OpenAPI available only outside production. Email via configured Resend; other external service adapters remain unimplemented |
| Infrastructure | PostgreSQL, Prisma migrations, Redis/jobs, private S3-compatible files, Docker, CI/CD, monitoring, backup and environments | PostgreSQL/Redis Compose foundation; runtime pool limits; readiness endpoint; API and web deployment instructions. All 9 recorded Neon production migrations applied and API readiness returned `ready`; no backup/restore operations |
| Quality and documentation | Unit, integration, API, end-to-end, threat/privacy review and deployment guides | 48 API unit tests, Prisma validation, API and web builds pass locally. No live PostgreSQL integration suite, end-to-end browser suite, cross-tenant proof against a non-production database, threat/privacy review or clinical/security certification |

## Required architecture and product constraints

- Prefer a modular monolith with clean domain boundaries and an option to separate high-load modules later.
- Intended stack: Next.js, React and TypeScript; Tailwind CSS and reusable accessible components; NestJS/TypeScript; PostgreSQL with Prisma; Redis and a reliable job queue; versioned REST/OpenAPI; realtime only where appropriate; React Native/Expo; private S3-compatible object storage; Docker and separate development, staging and production environments.
- Never authorize a tenant by trusting a client-supplied tenant ID. Resolve tenant context from authenticated membership and enforce it through every data-access path. The patient-directory query applies scoped Prisma filters and transaction-local RLS policies; those policies still require migration application and a non-superuser, non-`BYPASSRLS` runtime role.
- Platform Super Admin must not automatically receive access to patient records. Any emergency access/impersonation requires explicit purpose, time limits, disclosure, audit and alerting.
- Do not silently overwrite signed clinical records. Preserve authorship, signatures, timestamps, amendments and history.
- Verify payments server-side and provider webhooks cryptographically; use idempotency; distinguish payment, capture, settlement, refund and reconciliation. Do not store raw card data. Manual payments remain explicitly offline and auditable.
- Never fabricate results, claim real insurer approvals, release unverified results, or automate clinical decisions. AI assists qualified staff with human review and approved information.
- Keep real patient data out of this preview. No clinical/financial write APIs should be exposed before authentication, tenant isolation, authorization, audit, privacy and safety controls are implemented and reviewed.

## Increment history

### 0.4.0 — Hospital onboarding and first platform-admin control plane

- Added verified hospital applications with rate-limited, single-use email verification; MFA-gated Super Admin review; rejection/information requests; hospital/branch provisioning; invitation resend/revocation; and append-only audit events.
- Added hospital administrator invitation setup with password selection and mandatory TOTP enrollment, plus existing-account acceptance.
- Added an email-based first platform administrator bootstrap flow so no default password, setup token, or TOTP secret needs to be printed.
- Added hospital registration, verification, invitation acceptance, Super Admin sign-in, guarded dashboard pages, and local API rewrites.
- Added migrations, limited runtime grants, and five negative onboarding/bootstrap/authorization tests. Current local run: 23/23 API tests pass; Prisma validation and both application builds pass.
- Neon production migration/connection and Vercel runtime recovery remain unverified; email provider setup and first-admin bootstrap are pending. This increment does not make the application ready for real patient data.

### 0.5.0 — Platform activity review and build verification

- Added a paginated, filterable Super Admin activity feed that omits audit metadata and excludes hospital-scoped patient-directory access trails.
- Added least-privilege, column-level audit read grants and indexes for the new endpoint, plus coverage for pagination, metadata withholding, patient-trail exclusion, and reversed date ranges.
- Verified 29/29 API unit tests, Prisma schema validation, API production build, web TypeScript check, and Next.js production build.
- All 7 recorded migrations, including the new audit grant migration, were applied to Neon; API readiness returned `ready`; the Vercel production deployment for this commit is Ready. Email delivery, first Super Admin bootstrap, authenticated end-to-end login, and tenant-isolation proof against hosted Neon remain unverified. This is not approved for real patient records.

### 0.6.0 — One-time administrator setup hardening

- Made hospital invitation and first Super Admin setup preparation a single atomic claim. Replayed setup links and concurrent claims can no longer replace the prepared password or MFA secret.
- Added negative tests for replay and concurrent claim failures on both setup paths.
- Verified 33/33 API tests, Prisma schema validation, API production build, web TypeScript check, and Next.js production build. Commit `7d78a24` is pushed to GitHub `main` and deployed to Vercel Production (deployment `CnpEJ5KkafSpbUvXNp6iWUCC8N9g`, Ready). `/login` and `/super-admin/login` return 200; `/api/v1/health/ready` returns `ready`; unauthenticated `/super-admin` redirects to sign-in and the protected dashboard API returns 401. First Super Admin email delivery/bootstrap and authenticated dashboard use remain unverified because Resend sender credentials are not configured. Do not use real patient data until the remaining account, email, and tenant-isolation checks pass.

### 0.8.0 — Tenant-scoped patient registration

- Added authenticated demographic registration with verified tenant scope, server-generated opaque MRNs, strict field validation, narrowly scoped role permission, transaction-local RLS context, and audit events that omit patient demographics.
- Added forced Patient INSERT RLS and column-scoped runtime INSERT permission. The application runtime role cannot update or delete patient records.
- Applied migration `20261017170000_patient_registration` to Neon and verified Patient RLS is forced, the runtime role has neither superuser nor `BYPASSRLS`, registration permission is assigned to four staff roles, and patient UPDATE/DELETE privileges are absent.
- Verified 46/46 API unit tests, Prisma validation, API build, web TypeScript check, and the elevated Next.js production build. The public preview directory remains fictional; no patient data was inserted. Two-tenant RLS proof, authenticated browser E2E, first-admin email bootstrap, and clinical EMR workflows remain unverified or incomplete.

### 0.9.0 — Platform service health and login recovery placement

- Added a Super Admin-only service-health API that reports database connectivity and whether email delivery configuration is present, without exposing credentials, raw errors or patient data.
- Added dashboard service indicators so missing email configuration is visible to platform administrators; provider acceptance remains unverified until an email is sent.
- Moved “Forgot password?” directly below the password field on the login form.
- Added tests for configured/missing email status and safe degraded database status. Local API test run: 48/48 passing. Production build/deployment verification follows.

### 0.7.0 — Tenant-scoped appointment scheduling API

- Added authenticated appointment listing and requested-booking endpoints with bounded date ranges, explicit `appointment.read`/`appointment.schedule` permissions, verified patient/doctor lookups, branch scope derived from authorized membership, and audit events without free-text clinical reasons.
- Added forced appointment RLS policies for read/insert, limited the runtime database role to INSERT columns that cannot set status or reason, and added a PostgreSQL exclusion constraint to prevent overlapping active appointments for the same clinician.
- Applied migration `20261017150000_appointment_scheduling_api` to Neon after a read-only preflight found 0 existing appointments and 0 overlapping pairs. Verified the runtime role is not superuser/BYPASSRLS, appointment RLS is enabled and forced, and INSERT grants exclude status/reason.
- 42/42 API tests, Prisma validation, API build, and web TypeScript check pass. Database-level cross-tenant isolation and browser E2E scheduling remain unverified; the visible web schedule is still fictional preview data. Do not use real patient records until non-production tenant-isolation and clinical workflow review are complete.

### 0.3.0 — Authentication flow, permissions and RLS migration

- Added responsive hospital/patient login modes, password visibility, remember-me behavior, forgot/reset-password screens and an authenticated affiliation summary page.
- Added a same-origin Next.js BFF with a fixed authentication route allowlist, same-origin checks, server-only API configuration, safe forwarding of the session cookie and no-store responses.
- Added server-side hospital/patient login mode filtering, 12-hour/30-day session durations, one-use hashed reset tokens, session revocation after password reset, Resend delivery adapter and a non-sensitive database-readiness endpoint.
- Added tenant activation state, role/permission and hospital settings/subscription/patient-access-grant tables, seed roles and limited directory permission, transaction-scoped RLS policies and append-only audit-event triggers.
- Added auth/reset/session, readiness and tenant-isolation unit tests. Current run: 16/16 API unit tests pass; Prisma schema validates; web/API build passes.
- Neon project creation is complete on the Free Plan. Secure connection configuration and migrations are pending. The API has no production Vercel deployment or environment variables; the app is not ready for real patient data.

### 0.2.0 — Security and identity foundation

- Replaced the generated brand mark with the exact user-supplied JR Xpert HMS logo across the shared web brand component; removed the sidebar's prior generated branding treatment.
- Confirmed the source app had no “Trusted by 100+ Hospitals” claim; the user-provided badge is not included in the app.
- Added secure server-managed session authentication with scrypt password hashes, privileged-role MFA/TOTP enforcement, login throttling, password rotation, device/session revocation and audit records.
- Added tenant/hospital/branch membership validation and a limited, audited patient-directory endpoint with scoped queries and selected fields.
- Added database migrations, security configuration checks and targeted tests. Production deployment still requires database, key provisioning, API hosting and an independent security review.

### 0.1.0 — Foundation preview

- Added branded responsive dashboard, synthetic patient directory and appointment views, and planned-module placeholders.
- Added a public marketing page introducing JR Xpert HMS and linking to the explicitly labeled workspace preview.
- Added Next.js/React web workspace and Tailwind CSS pipeline.
- Added the initial NestJS API shell with `/api/v1/health`, OpenAPI UI and one liveness test.
- Added initial Prisma/PostgreSQL domain contract and local PostgreSQL/Redis Compose services.
- No production readiness claim. Full patient EMR, appointment, pharmacy, laboratory, financial, insurance, HR, mobile and live integrations remain unimplemented.
