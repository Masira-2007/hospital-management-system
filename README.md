# JR Xpert HMS

**Better Care. Smarter Management. Healthier Tomorrow.**

JR Xpert HMS is an in-progress, multi-hospital healthcare platform. The current public dashboard remains a visual preview using fictional sample records. The web app, API and database are not yet connected in a deployed environment; do not enter real patient information.

## What is implemented

- JR Xpert public product page, logo and responsive dashboard preview. The preview uses fictional records and is not an operational EHR.
- Responsive `/login`, `/forgot-password`, `/reset-password` and `/workspace` pages. Hospital and patient login modes, password visibility, optional MFA code, and server-managed remember-me session lengths are wired to the API through an allowlisted same-origin Next.js route handler.
- NestJS API with versioned REST routes, strict DTO validation, Helmet, exact-origin CORS and CSRF origin checks for state-changing requests.
- Active, email-verified account login using scrypt password hashes, opaque server-managed `HttpOnly`, `SameSite=Strict` cookies, MFA/TOTP enforcement for privileged roles, database-backed rate limiting, session revocation, password reset tokens stored as hashes, and audit events.
- Resend password recovery adapter. It returns a setup error until `RESEND_API_KEY`, a verified `AUTH_EMAIL_FROM`, and `APP_URL` are configured; it never reports a fake email delivery.
- Multi-hospital schema for organizations, hospitals, branches, memberships, role definitions, permissions, hospital settings, subscriptions, and patient access grants. Hospital status and membership are checked server-side.
- Patient-directory read endpoint with role-permission lookup, verified tenant membership, a limited field set, bounded search/pagination, access auditing, and transaction-scoped PostgreSQL row-level security for patient and appointment reads.
- Append-only audit-event triggers and a database readiness endpoint that returns no connection details.
- Prisma migrations and safe placeholder environment configuration.

## Not ready for real patient data

The Neon organization and `JR Xpert HMS` PostgreSQL project have been created on the Free Plan in AWS Asia Pacific 1 (Singapore). The Prisma migrations have not been applied, and no database connection URL has been configured for the application. The existing Vercel web project is connected to Git, but it has no application environment variables; the NestJS API has not yet been deployed. Until API configuration is complete, the login BFF returns an explicit `API_NOT_CONFIGURED` message.

Other unfinished scope includes hospital onboarding and staff invitation flows, MFA enrollment, patient registration and clinical EMR writes, appointments, nursing/ward/OT workflows, pharmacy, laboratory, billing and payments, insurance, inventory, HR/payroll, mobile apps, notifications beyond password recovery, AI workflows, production monitoring/backups, and end-to-end testing against PostgreSQL. This is not a complete HMS or a compliance certification.

## Local development

Requirements: Node.js 24.15+ and npm. Copy `.env.example` to `.env`, then replace every placeholder with local development values. Do not commit `.env`.

```powershell
Copy-Item .env.example .env
npm install
docker compose up -d postgres redis
npm run db:generate
npm run db:migrate:dev --workspace @jr-xpert/api
npm run dev
```

The web app runs at `http://localhost:3000`; the API runs at `http://localhost:4000/api/v1`; development-only OpenAPI UI is exposed by the API. Provide a PostgreSQL URL before starting the API. For local migrations, `DIRECT_URL` can point to the same local database.

```powershell
npm test
npm run db:validate
npm run build
```

If a local Next dev server holds `.next` open, run a separate verification build with `$env:NEXT_DIST_DIR='.next-verify'; npm run build`.

## Neon and Vercel setup

The monorepo contains two separately deployable applications. Vercel documents NestJS as a supported single-function backend and supports separate projects for folders in a monorepo ([NestJS](https://vercel.com/docs/frameworks/backend/nestjs), [monorepos](https://vercel.com/docs/monorepos)).

1. The Neon Free Plan project is already created. In Neon, retrieve the **pooled** URL for runtime and the **direct** URL for migrations. Keep both private and add them only to protected environment settings or ignored local environment files.
2. Apply the reviewed migration to a non-production database with `npm run db:migrate:deploy --workspace @jr-xpert/api`, after configuring `DIRECT_URL` and `DATABASE_URL`. Check that the migration succeeds and test the row-level security policies before using real data.
3. Create a Vercel project for the API from the same Git repository with Root Directory `apps/api`. Set protected API environment variables: `DATABASE_URL`, `DIRECT_URL`, `APP_URL`, `WEB_ORIGIN`, `AUTH_RATE_LIMIT_SECRET`, `MFA_ENCRYPTION_KEY`. Set `RESEND_API_KEY` and a verified `AUTH_EMAIL_FROM` only when password recovery email is ready.
4. Deploy the API and verify `/api/v1/health` and `/api/v1/health/ready`. The readiness endpoint must report 503 until it can reach PostgreSQL.
5. In the existing web project (Root Directory `apps/web`), set server-only `JR_XPERT_API_URL` to the API’s `https://.../api/v1` URL and `WEB_ORIGIN` to the exact HTTPS web origin. Do not use `NEXT_PUBLIC_` for API secrets or connection strings.
6. Deploy the web app, test login, logout, remember-me, password visibility, recovery pages and tenant isolation against non-production test accounts, then review logs for errors. Do not provision real patient data until the production database role, RLS, backups, access policies and compliance obligations have been reviewed.

Production API startup also requires `DATABASE_URL`, an HTTPS `APP_URL` included in the exact `WEB_ORIGIN` allowlist, a unique 32+ character `AUTH_RATE_LIMIT_SECRET`, and a 32-byte hexadecimal `MFA_ENCRYPTION_KEY`. Use a least-privilege runtime database role that is neither superuser nor `BYPASSRLS`; `FORCE ROW LEVEL SECURITY` cannot constrain those privileged PostgreSQL roles. Use separate preview/staging/production credentials and databases.

The Neon project is confirmed on the Free Plan at $0/month; no payment was made. Its connection details have not been copied into the application, and migrations have not been applied. The existing Vercel project is connected to the Git repository, but it has no database/API environment settings. No production API deployment or live authenticated login has been verified.

## Security notes

- Tenant identifiers from request headers are only context selectors; every selection is checked against active memberships and active hospital records.
- The patient endpoint applies tenant filters and PostgreSQL RLS in the same interactive transaction; GUC tenant context is transaction-local for connection-pool safety.
- The production runtime DB role must not bypass RLS. A database migration succeeding alone is not proof of isolation.
- The preview uses synthetic information only. The current API implements a patient directory read, not full clinical records.
- Security controls do not establish DPDP, ABDM, HIPAA, or other legal/compliance status. Obtain the required legal, operational and technical review before production healthcare use.

See [PRODUCT_SPEC.md](./PRODUCT_SPEC.md) for the larger product scope and implementation status.
