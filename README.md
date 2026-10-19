# JR Xpert HMS

**Better Care. Smarter Management. Healthier Tomorrow.**

JR Xpert HMS is an in-progress, multi-hospital healthcare platform. The public dashboard remains a visual preview using fictional sample records. Backend onboarding and authentication are implemented; production migrations are applied and API database readiness is verified. Account bootstrap, email delivery, live authenticated workflows, and tenant-isolation testing still need completion before any real patient information is used.

## What is implemented

- JR Xpert public product page, logo and responsive dashboard preview. The preview uses fictional records and is not an operational EHR.
- Responsive `/login`, `/forgot-password`, `/reset-password` and `/workspace` pages. Hospital and patient login modes, password visibility, optional MFA code, and server-managed remember-me session lengths are wired to the API through an allowlisted same-origin Next.js route handler.
- NestJS API with versioned REST routes, strict DTO validation, Helmet, exact-origin CORS and CSRF origin checks for state-changing requests.
- Active, email-verified account login using scrypt password hashes, opaque server-managed `HttpOnly`, `SameSite=Strict` cookies, MFA/TOTP enforcement for privileged roles, database-backed rate limiting, session revocation, password reset tokens stored as hashes, and audit events.
- Resend password recovery adapter. It returns a setup error until `RESEND_API_KEY`, a verified `AUTH_EMAIL_FROM`, and `APP_URL` are configured; it never reports a fake email delivery.
- Hospital application submission and email verification, MFA-gated platform review APIs, provisioning of organizations/hospitals/branches, one-time hospital administrator invitations, and invitation acceptance with mandatory TOTP enrollment. Setup tokens are claimed atomically and cannot be replayed to replace password/MFA setup. The UI includes hospital registration, email verification, invitation setup, and a protected Super Admin onboarding dashboard.
- A first-Super-Admin bootstrap script that sends a one-time email setup link; its preparation token is also single-claim. No default administrator credentials or bootstrap tokens are printed.
- A protected Super Admin dashboard for hospital onboarding and platform operations, with paginated audit summaries. Patient-directory access trails stay tenant-scoped and audit metadata is not exposed.
- A Super Admin-only service-health view for Neon connectivity and email-configuration presence; it never returns secrets or raw database errors. Email sender acceptance still needs to be checked through a real provider send.
- Multi-hospital schema for organizations, hospitals, branches, memberships, role definitions, permissions, hospital settings, subscriptions, and patient access grants. Hospital status and membership are checked server-side.
- Patient-directory read endpoint with role-permission lookup, verified tenant membership, a limited field set, bounded search/pagination, access auditing, and transaction-scoped PostgreSQL row-level security.
- Patient registration endpoint for authorized hospital staff, with strict demographic validation, a server-generated MRN, server-derived tenant scope, an explicit role permission, transaction-local forced RLS, a limited INSERT grant, and audit metadata that excludes patient demographics. No update/delete permission is granted to the runtime role.
- Appointment list and requested-booking API with explicit permissions, verified patient/doctor membership, branch-derived scope, audit events, appointment RLS, restricted runtime insert columns, and a database-level clinician overlap constraint. The visible schedule remains a fictional preview and is not wired to these APIs.
- Append-only audit-event triggers and a database readiness endpoint that returns no connection details.
- Prisma migrations and safe placeholder environment configuration.

## Not ready for real patient data

All 9 recorded Neon production migrations, including appointment scheduling and patient registration RLS, were applied successfully on 2026-10-17. Read-only database verification confirmed forced Patient RLS, a runtime role without superuser or `BYPASSRLS`, role-gated registration permission, and no runtime Patient update/delete grant. The live API readiness endpoint previously returned `ready`. All 48 API unit tests, Prisma validation, API build, web TypeScript check, and elevated Next.js production build pass. This does not verify two-hospital isolation in a non-production database, authenticated end-to-end workflows, account bootstrap/email delivery, or backup restoration. Do not enter real patient information until those checks and an independent security review are complete.

Other unfinished scope includes patient self-service portal and clinical EMR writes, appointment availability/reschedule/cancel/check-in/queues, nursing/ward/OT workflows, pharmacy, laboratory, billing and payments, insurance, inventory, HR/payroll, mobile apps, notifications beyond account recovery/onboarding, AI workflows, production monitoring/backups, and end-to-end testing against PostgreSQL. This is not a complete HMS or a compliance certification.

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

## Neon and Vercel setup

The monorepo contains two separately deployable applications. Vercel documents NestJS as a supported single-function backend and supports separate projects for folders in a monorepo ([NestJS](https://vercel.com/docs/frameworks/backend/nestjs), [monorepos](https://vercel.com/docs/monorepos)).

1. In Neon, use the pooled URL for runtime and the direct migration/owner URL for schema changes. Keep the runtime role `jr_xpert_app` non-superuser and without `BYPASSRLS`; it must exist before the onboarding grants migration runs.
2. Run production migrations from a trusted runner that can reach Neon’s direct endpoint; do not run migrations as part of the Vercel build. Put `DIRECT_URL` only in the ignored local `.env`, run `npm run db:migrate:deploy --workspace @jr-xpert/api`, then verify migration history and RLS with two synthetic hospitals in a non-production environment.
3. Configure protected API environment variables in Vercel: pooled `DATABASE_URL`, HTTPS `APP_URL`, exact HTTPS `WEB_ORIGIN`, `AUTH_RATE_LIMIT_SECRET`, and `MFA_ENCRYPTION_KEY`. Set `RESEND_API_KEY` and a verified `AUTH_EMAIL_FROM` for recovery and onboarding mail. The application runtime uses only `DATABASE_URL`.
4. After migrations succeed, deploy the API service, then verify `/api/v1/health` and `/api/v1/health/ready`. A 200 readiness response confirms database connectivity; run account-flow checks separately.
5. In the web service, set server-only `JR_XPERT_API_URL` to the API’s HTTPS origin/path and `WEB_ORIGIN` to the exact web origin. Do not use `NEXT_PUBLIC_` for server secrets or connection strings.
6. Once migrations and email are ready, run the first-admin bootstrap from an authorized operator environment with `BOOTSTRAP_DATABASE_URL`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME`, and `BOOTSTRAP_CONFIRM=CREATE_FIRST_SUPER_ADMIN`. The script sends a short-lived one-time setup link; complete password and MFA enrollment from that link.
7. Verify login, logout, password visibility, recovery, hospital registration/email verification, invitation setup, Super Admin authorization, and tenant isolation using synthetic accounts before any real data is entered.

Production API startup also requires `DATABASE_URL`, an HTTPS `APP_URL` included in the exact `WEB_ORIGIN` allowlist, a unique 32+ character `AUTH_RATE_LIMIT_SECRET`, and a 32-byte hexadecimal `MFA_ENCRYPTION_KEY`. Use a least-privilege runtime database role that is neither superuser nor `BYPASSRLS`; `FORCE ROW LEVEL SECURITY` cannot constrain those privileged PostgreSQL roles. Use separate preview/staging/production credentials and databases.

No Neon connection string or Vercel secret is stored in this repository. Production API readiness and the recorded migration set were verified. An authenticated Neon write/read check, email delivery, first administrator bootstrap, live authenticated login, and tenant-isolation proof against Neon have not been verified in this workspace.

## Security notes

- Tenant identifiers from request headers are only context selectors; every selection is checked against active memberships and active hospital records.
- The patient endpoint applies tenant filters and PostgreSQL RLS in the same interactive transaction; GUC tenant context is transaction-local for connection-pool safety.
- The production runtime DB role must not bypass RLS. A database migration succeeding alone is not proof of isolation.
- The preview uses synthetic information only. The current API implements a patient directory read, not full clinical records.
- Security controls do not establish DPDP, ABDM, HIPAA, or other legal/compliance status. Obtain the required legal, operational and technical review before production healthcare use.

See [PRODUCT_SPEC.md](./PRODUCT_SPEC.md) for the larger product scope and implementation status.
