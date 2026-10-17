# JR Xpert HMS

**Better Care. Smarter Management. Healthier Tomorrow.**

JR Xpert HMS is an in-progress, multi-hospital healthcare platform. The public dashboard remains a visual preview using fictional sample records. Backend onboarding and authentication are implemented, but production database migrations, account bootstrap, and live end-to-end authorization must be verified before real patient information is used.

## What is implemented

- JR Xpert public product page, logo and responsive dashboard preview. The preview uses fictional records and is not an operational EHR.
- Responsive `/login`, `/forgot-password`, `/reset-password` and `/workspace` pages. Hospital and patient login modes, password visibility, optional MFA code, and server-managed remember-me session lengths are wired to the API through an allowlisted same-origin Next.js route handler.
- NestJS API with versioned REST routes, strict DTO validation, Helmet, exact-origin CORS and CSRF origin checks for state-changing requests.
- Active, email-verified account login using scrypt password hashes, opaque server-managed `HttpOnly`, `SameSite=Strict` cookies, MFA/TOTP enforcement for privileged roles, database-backed rate limiting, session revocation, password reset tokens stored as hashes, and audit events.
- Resend password recovery adapter. It returns a setup error until `RESEND_API_KEY`, a verified `AUTH_EMAIL_FROM`, and `APP_URL` are configured; it never reports a fake email delivery.
- Hospital application submission and email verification, MFA-gated platform review APIs, provisioning of organizations/hospitals/branches, one-time hospital administrator invitations, and invitation acceptance with mandatory TOTP enrollment. The UI includes hospital registration, email verification, invitation setup, and a protected Super Admin onboarding dashboard.
- A first-Super-Admin bootstrap script that sends a one-time email setup link; no default administrator credentials or bootstrap tokens are printed.
- Multi-hospital schema for organizations, hospitals, branches, memberships, role definitions, permissions, hospital settings, subscriptions, and patient access grants. Hospital status and membership are checked server-side.
- Patient-directory read endpoint with role-permission lookup, verified tenant membership, a limited field set, bounded search/pagination, access auditing, and transaction-scoped PostgreSQL row-level security for patient and appointment reads.
- Append-only audit-event triggers and a database readiness endpoint that returns no connection details.
- Prisma migrations and safe placeholder environment configuration.

## Not ready for real patient data

The repository has not been given a local Neon connection string. New migrations for platform applications, invitations, bootstrap tokens, and limited app-role grants have not been verified against the hosted Neon database in this workspace. The browser showed a Vercel API runtime invocation error during earlier checks; the current API deployment and its runtime secrets still need a successful remote health/readiness check. Do not enter real patient information until migration status, RLS behavior, backups, and the live database role are verified.

Other unfinished scope includes patient registration and clinical EMR writes, appointments, nursing/ward/OT workflows, pharmacy, laboratory, billing and payments, insurance, inventory, HR/payroll, mobile apps, notifications beyond account recovery/onboarding, AI workflows, production monitoring/backups, and end-to-end testing against PostgreSQL. This is not a complete HMS or a compliance certification.

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
2. For local development, run migrations with `DIRECT_URL` set to the local migration owner. Vercel production API builds run the reviewed `prisma migrate deploy` migrations before compiling; preview builds do not touch production schema. Verify migration history and RLS with two synthetic hospitals in a non-production environment.
3. Configure protected API environment variables in Vercel: pooled `DATABASE_URL`, production `DIRECT_URL` for the controlled build-time migration step, HTTPS `APP_URL`, exact HTTPS `WEB_ORIGIN`, `AUTH_RATE_LIMIT_SECRET`, and `MFA_ENCRYPTION_KEY`. Set `RESEND_API_KEY` and a verified `AUTH_EMAIL_FROM` for recovery and onboarding mail. The application runtime uses only `DATABASE_URL`.
4. Deploy the API service, then verify `/api/v1/health` and `/api/v1/health/ready`. A 200 readiness response confirms database connectivity, while the production build fails if its pending migrations fail.
5. In the web service, set server-only `JR_XPERT_API_URL` to the API’s HTTPS origin/path and `WEB_ORIGIN` to the exact web origin. Do not use `NEXT_PUBLIC_` for server secrets or connection strings.
6. Once migrations and email are ready, run the first-admin bootstrap from an authorized operator environment with `BOOTSTRAP_DATABASE_URL`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME`, and `BOOTSTRAP_CONFIRM=CREATE_FIRST_SUPER_ADMIN`. The script sends a short-lived one-time setup link; complete password and MFA enrollment from that link.
7. Verify login, logout, password visibility, recovery, hospital registration/email verification, invitation setup, Super Admin authorization, and tenant isolation using synthetic accounts before any real data is entered.

Production API startup also requires `DATABASE_URL`, an HTTPS `APP_URL` included in the exact `WEB_ORIGIN` allowlist, a unique 32+ character `AUTH_RATE_LIMIT_SECRET`, and a 32-byte hexadecimal `MFA_ENCRYPTION_KEY`. Use a least-privilege runtime database role that is neither superuser nor `BYPASSRLS`; `FORCE ROW LEVEL SECURITY` cannot constrain those privileged PostgreSQL roles. Use separate preview/staging/production credentials and databases.

No Neon connection string or Vercel secret is stored in this repository. A local authenticated Neon write/read/migration check, production API readiness, email delivery, first administrator bootstrap, and live authenticated login have not been verified in this workspace.

## Security notes

- Tenant identifiers from request headers are only context selectors; every selection is checked against active memberships and active hospital records.
- The patient endpoint applies tenant filters and PostgreSQL RLS in the same interactive transaction; GUC tenant context is transaction-local for connection-pool safety.
- The production runtime DB role must not bypass RLS. A database migration succeeding alone is not proof of isolation.
- The preview uses synthetic information only. The current API implements a patient directory read, not full clinical records.
- Security controls do not establish DPDP, ABDM, HIPAA, or other legal/compliance status. Obtain the required legal, operational and technical review before production healthcare use.

See [PRODUCT_SPEC.md](./PRODUCT_SPEC.md) for the larger product scope and implementation status.
