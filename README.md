# JR Xpert HMS

**Better Care. Smarter Management. Healthier Tomorrow.**

JR Xpert HMS is an in-progress, multi-hospital healthcare platform. The public dashboard remains a visual preview using fictional sample records. Backend onboarding, authentication, and a read-only patient self-service API are implemented; production migrations are applied and Neon runtime-role/RLS configuration is verified. Resend is now configured in Vercel Production and the updated deployment is Ready, but actual email delivery and authenticated workflows still need verification before any real patient information is used.

## What is implemented

- JR Xpert public product page, logo and responsive dashboard preview. The preview uses fictional records and is not an operational EHR.
- Responsive `/login`, `/super-admin/login`, `/forgot-password`, `/reset-password` and `/workspace` pages. Hospital, patient and platform-admin sign-in use a password followed by a one-time email code. Forgot Password appears below the password field, aligned to the right. Google and Apple sign-in are intentionally not offered.
- NestJS API with versioned REST routes, strict DTO validation, Helmet, exact-origin CORS and CSRF origin checks for state-changing requests.
- Active, email-verified account login using scrypt password hashes, a ten-minute single-use email code (keyed hash at rest, five-attempt cap), opaque server-managed `HttpOnly`, `SameSite=Strict` cookies, atomic database-backed rate limits with periodic stale-key pruning, session revocation, password reset tokens stored as hashes, and audit events. Hospital and Super Admin use the same verified code flow.
- Portal role is enforced by the API: hospital login excludes platform-only administrator memberships, and Super Admin login accepts only an unscoped platform membership. Selecting a portal in the browser never grants a role.
- Resend delivery adapter for sign-in codes, password recovery and onboarding. It returns a setup error until `RESEND_API_KEY` and a verified `AUTH_EMAIL_FROM` are configured; it never reports a fake email delivery. The `hms.jrxpert.in` sender domain is DNS-verified, and a sending-only key plus `JR Xpert <no-reply@hms.jrxpert.in>` are configured in Vercel Production. The environment update was redeployed successfully; real email delivery and email-code sign-in have not yet been exercised.
- Google and Apple sign-in endpoints and buttons are not included. Login sessions have a fixed 12-hour lifetime; users cannot extend session duration from the login request.
- Hospital application submission and email verification, email-code-authenticated platform review APIs, provisioning of organizations/hospitals/branches, one-time hospital administrator invitations, and invitation acceptance with mandatory TOTP enrollment. Setup tokens are claimed atomically and cannot be replayed to replace password/MFA setup. Parallel applications using the same official email are serialized inside a PostgreSQL transaction to prevent duplicate hospital provisioning. The UI includes hospital registration, email verification, invitation setup, and a protected Super Admin onboarding dashboard.
- A first-Super-Admin bootstrap script that sends a one-time email setup link, followed by a six-digit code to the same email for activation. Setup codes are single-use and hashed at rest; no default administrator credentials or bootstrap tokens are printed. Super Admin dashboard access is limited to an active platform-scoped membership after the email-code login.
- A protected Super Admin dashboard for hospital onboarding and platform operations, with section navigation, service health, searchable/paginated hospital, staff and subscription lists, reasoned suspension/reactivation, invitation resend/revocation, and a paginated audit feed. Patient-directory access trails stay tenant-scoped and audit metadata is not exposed.
- A protected, read-only `/patient` portal for signed-in patient accounts. It requires a selected patient membership, retrieves records only through active explicit patient-access grants in the API, and displays limited identity fields with no-store caching. It does not expose clinical notes, results, prescriptions, appointments, or billing.
- Paginated, searchable Super Admin staff-account access operations. Patient-only and mixed patient/staff accounts and platform admins are excluded. Suspension is global across a staff account’s hospital memberships, revokes active sessions and pending email login codes, and records a reasoned audit event transactionally. Login session creation rechecks account status under a row lock to prevent suspension races.
- A server-guarded `/super-admin/security` page to review this administrator account’s active sessions, revoke one device, or revoke every other session. Session management data is returned only for the authenticated account, session changes and their audit events commit atomically, and session tokens are never displayed.
- Multi-hospital workspace selection after sign-in. A single authorized membership is selected automatically; for multiple memberships, the user chooses one, the API validates ownership/status and stores the selection on that session, and tenant guards bind each request to that membership while rechecking its active status.
- A Super Admin-only service-health view for Neon connectivity and email-configuration presence; it never returns secrets or raw database errors. Email sender acceptance still needs to be checked through a real provider send.
- Multi-hospital schema for organizations, hospitals, branches, memberships, role definitions, permissions, hospital settings, subscriptions, and patient access grants. Hospital status and membership are checked server-side.
- Patient-directory read endpoint with role-permission lookup, verified tenant membership, a limited field set, bounded search/pagination, access auditing, and transaction-scoped PostgreSQL row-level security.
- Read-only `GET /api/v1/patients/me` for authenticated patient accounts, requiring an active hospital membership and explicit non-revoked, non-expired record-access grant. The query is limited to the selected organization/hospital/branch, returns only basic identity fields, and audits the aggregate result count without recording patient identifiers.
- Patient registration endpoint for authorized hospital staff, with strict demographic validation, a server-generated MRN, server-derived tenant scope, an explicit role permission, transaction-local forced RLS, a limited INSERT grant, and audit metadata that excludes patient demographics. No update/delete permission is granted to the runtime role.
- Appointment list and requested-booking API with explicit permissions, verified patient/doctor membership, branch-derived scope, audit events, appointment RLS, restricted runtime insert columns, and a database-level clinician overlap constraint. The visible schedule remains a fictional preview and is not wired to these APIs.
- Append-only audit-event triggers and a database readiness endpoint that returns no connection details.
- Prisma migrations and safe placeholder environment configuration.

## Not ready for real patient data

Production was checked on 2026-10-20 at [hms.jrxpert.in](https://hms.jrxpert.in): `/api/v1/health/ready` reports `ready`, and `/forgot-password` renders. The Resend sender domain `hms.jrxpert.in` is DNS-verified. A fresh sending-only `RESEND_API_KEY` and `AUTH_EMAIL_FROM=JR Xpert <no-reply@hms.jrxpert.in>` are configured in Vercel Production; deployment `JAtYqssYQCfFPu8icBsZ7f2BUmtf` is Ready. The previous exposed key and unused rotation key have been revoked. A request using a reserved `.invalid` probe address returns the generic recovery confirmation, which verifies the setup-error response is gone but does not verify real email delivery or authenticated email-code login. The two-hospital SQL integration test is skipped on this development machine because Docker/PostgreSQL test URLs are unavailable; no patient or real-account data was used. Authenticated end-to-end workflows, first-admin email bootstrap, backup restoration and an independent security review remain outstanding. Do not enter real patient information until those checks are complete.

`.github/workflows/ci.yml` now provisions an ephemeral PostgreSQL service, applies the migrations with test-only credentials, and runs the two-hospital isolation test using synthetic fixtures. The workflow has not yet run on GitHub, so it does not count as a passing isolation test.

Other unfinished scope includes clinical EMR reads/writes, appointment availability/reschedule/cancel/check-in/queues, nursing/ward/OT workflows, pharmacy, laboratory, billing and payments, insurance, inventory, HR/payroll, mobile apps, notifications beyond account recovery/onboarding, AI workflows, production monitoring/backups, and cross-tenant end-to-end testing against a dedicated non-production PostgreSQL database. This is not a complete HMS or a compliance certification.

## Local development

Requirements: Node.js 24.15+ and npm. Copy `.env.example` to `.env`, then replace every placeholder with local development values. Do not commit `.env`.

```powershell
Copy-Item .env.example .env
npm install
docker compose up -d postgres redis
docker compose exec -T postgres psql -U jr_xpert -d jr_xpert_hms -c "CREATE ROLE jr_xpert_app LOGIN PASSWORD 'jr_xpert_app_dev';"
npm run db:generate
npm run db:migrate:dev --workspace @jr-xpert/api
npm run dev
```

Before starting the app, edit the ignored `.env` so local runtime `DATABASE_URL` uses `jr_xpert_app` and `DIRECT_URL` uses the local migration owner `jr_xpert` from `docker-compose.yml`. The local example password above is for development only. The web app runs at `http://localhost:3000`; the API runs at `http://localhost:4000/api/v1`; development-only OpenAPI UI is exposed by the API. Local Next development proxies `/api/v1/*` to the API.

```powershell
npm test
npm run db:validate
npm run build
```

If a local Next dev server holds `.next` open, run a separate verification build with `$env:NEXT_DIST_DIR='.next-verify'; npm run build`.

### Two-hospital tenant-isolation integration test

This test is optional and requires Docker Desktop. It creates only synthetic records in the dedicated local `jr_xpert_hms_test` database. It refuses remote hosts or a database with any other name. It does not connect to Neon or Vercel.

```powershell
docker compose up -d postgres-test
$env:DIRECT_URL='postgresql://jr_xpert_test_owner:jr_xpert_test_owner_dev@127.0.0.1:5433/jr_xpert_hms_test?schema=public'
$env:TENANT_ISOLATION_TEST_OWNER_URL=$env:DIRECT_URL
$env:TENANT_ISOLATION_TEST_APP_URL='postgresql://jr_xpert_app:jr_xpert_app_test@127.0.0.1:5433/jr_xpert_hms_test?schema=public'
npm run db:migrate:deploy --workspace @jr-xpert/api
npm run test:tenant-isolation --workspace @jr-xpert/api
```

The test checks that a non-superuser, non-`BYPASSRLS` runtime role can read only its own hospital’s patient and appointment rows, that forged tenant context still cannot access another tenant’s rows, and that unauthorized writes are rejected. A historical migration grants database CONNECT to Neon’s default `neondb`; the isolated local fixture creates an inert local database with that name solely to keep the applied migration history immutable. The test refuses remote database URLs. If its two local URLs are missing, it reports a clear skip with setup guidance instead of failing during module loading. Docker/PostgreSQL is not installed in the current development environment, so the SQL isolation assertions still need to be run on a machine with Docker Desktop or a local PostgreSQL server.

## Neon and Vercel setup

The monorepo contains two separately deployable applications. Vercel documents NestJS as a supported single-function backend and supports separate projects for folders in a monorepo ([NestJS](https://vercel.com/docs/frameworks/backend/nestjs), [monorepos](https://vercel.com/docs/monorepos)).

1. In Neon, use the pooled URL for runtime and the direct migration/owner URL for schema changes. Keep the runtime role `jr_xpert_app` non-superuser and without `BYPASSRLS`; it must exist before the onboarding grants migration runs.
2. Run production migrations from a trusted runner that can reach Neon’s direct endpoint; do not run migrations as part of the Vercel build. Put `DIRECT_URL` only in the ignored local `.env`, run `npm run db:migrate:deploy --workspace @jr-xpert/api`, then verify migration history and RLS with two synthetic hospitals in a non-production environment.
3. Configure protected API environment variables in Vercel: pooled `DATABASE_URL`, HTTPS `APP_URL`, exact HTTPS `WEB_ORIGIN`, `AUTH_RATE_LIMIT_SECRET`, and `MFA_ENCRYPTION_KEY`. Set `RESEND_API_KEY` and a verified `AUTH_EMAIL_FROM` before deploying email-code login. Google and Apple sign-in are not part of the application. The application runtime uses only `DATABASE_URL`.
4. After migrations succeed, deploy the API service, then verify `/api/v1/health` and `/api/v1/health/ready`. A 200 readiness response confirms database connectivity; run account-flow checks separately.
5. In the web service, set server-only `JR_XPERT_API_URL` to the API’s HTTPS origin/path and `WEB_ORIGIN` to the exact web origin. Do not use `NEXT_PUBLIC_` for server secrets or connection strings.
6. Once migrations and email are ready, run the first-admin bootstrap from an authorized operator environment with `BOOTSTRAP_DATABASE_URL`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME`, and `BOOTSTRAP_CONFIRM=CREATE_FIRST_SUPER_ADMIN`. The script sends a short-lived one-time setup link; set a password and confirm the emailed one-time code to activate the admin.
7. Verify login, logout, password visibility, recovery, hospital registration/email verification, invitation setup, Super Admin authorization, and tenant isolation using synthetic accounts before any real data is entered.

Production API startup also requires `DATABASE_URL`, an HTTPS `APP_URL` included in the exact `WEB_ORIGIN` allowlist, a unique 32+ character `AUTH_RATE_LIMIT_SECRET`, and a 32-byte hexadecimal `MFA_ENCRYPTION_KEY`. Use a least-privilege runtime database role that is neither superuser nor `BYPASSRLS`; `FORCE ROW LEVEL SECURITY` cannot constrain those privileged PostgreSQL roles. Use separate preview/staging/production credentials and databases.

No Neon connection string or Vercel secret is stored in this repository. Neon migration status and the read-only runtime-role verifier were run successfully for all 13 migrations; the verifier checks session-scope permissions, forced Patient/PatientAccessGrant RLS, patient grant policies and restricted runtime-role attributes. API unit tests and builds do not substitute for cross-tenant end-to-end tests. Email delivery, first administrator bootstrap, live authenticated login and isolation proof against a dedicated non-production database have not been verified in this workspace.

## Security notes

- Tenant identifiers from request headers are only context selectors; every selection is checked against active memberships and active hospital records.
- The patient endpoint applies tenant filters and PostgreSQL RLS in the same interactive transaction; GUC tenant context is transaction-local for connection-pool safety.
- The production runtime DB role must not bypass RLS. A database migration succeeding alone is not proof of isolation.
- The preview uses synthetic information only. The current API implements a patient directory read, not full clinical records.
- Security controls do not establish DPDP, ABDM, HIPAA, or other legal/compliance status. Obtain the required legal, operational and technical review before production healthcare use.

See [PRODUCT_SPEC.md](./PRODUCT_SPEC.md) for the larger product scope and implementation status.
