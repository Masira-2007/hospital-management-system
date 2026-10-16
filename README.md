# JR Xpert HMS

**Better Care. Smarter Management. Healthier Tomorrow.**

JR Xpert HMS is an in-progress multi-hospital healthcare platform. The web workspace remains a responsive visual preview with fictional sample records. This increment adds an API security foundation and a narrowly scoped patient-directory endpoint; it is not a complete or production-certified hospital system.

## Current increment

- Public JR Xpert product page and responsive hospital workspace preview.
- The supplied JR Xpert HMS logo is cropped from the provided image and reused in the public header, dashboard sidebar, preview and footer.
- The codebase contains no “Trusted by 100+ Hospitals” badge or count.
- NestJS API with Helmet headers, exact-origin CORS allowlist, unsafe-request Origin checks, strict DTO validation, bounded patient queries and production-disabled Swagger.
- Password authentication using salted scrypt hashes; MFA/TOTP required for privileged roles; opaque server-managed `HttpOnly`, `SameSite=Strict` sessions; 12-hour expiry; session listing/revocation; password change and revocation of existing sessions.
- Database-backed login throttles, generic authentication failures and audit events for login, logout, password changes, session revocation and patient-directory access.
- Tenant context is resolved from authenticated memberships. Patient directory access is scoped by organization, hospital and optionally branch, with role checks and compound tenant/hospital/branch foreign keys.
- PostgreSQL Prisma schema and an initial migration for organizations, hospitals, branches, users, memberships, patients, appointments, audit events, sessions and rate-limit buckets.
- Unit coverage for password/session/TOTP primitives and tenant-membership enforcement.

All browser dashboard records are still fictional and the web UI is not connected to the API. No real patient data should be entered into the preview.

## API scope and limits

Implemented endpoints under `/api/v1`:

- `GET /health`
- `POST /auth/login`
- `GET /auth/me`
- `POST /auth/logout`
- `POST /auth/password`
- `GET /auth/sessions`
- `DELETE /auth/sessions/:sessionId`
- `POST /auth/sessions/revoke-others`
- `GET /patients` (requires an authenticated session, active permitted role, and `x-organization-id` plus `x-hospital-id`; optionally `x-branch-id`)

Accounts must be provisioned and verified by a controlled operator process. There is no public registration, invitation/email verification, password recovery, MFA enrollment UI, SSO/passkeys, Redis-backed queue, clinical EMR write API, appointment booking API, payments, pharmacy, laboratory, mobile app or insurance integration yet. MFA enrollment requires a protected provisioning process and a securely stored encrypted TOTP secret. The API does not currently implement PostgreSQL row-level security; every enabled data query must continue to use tenant-scoped service logic and should receive a separate security review before real PHI is used.

## Run locally

Requirements: Node.js 24.15+ and npm.

```powershell
Copy-Item .env.example .env
npm install
docker compose up -d postgres redis
npm run db:generate
npm run db:migrate:dev --workspace @jr-xpert/api
npm run dev
```

The web preview runs at `http://localhost:3000`, the API at `http://localhost:4000/api/v1`, and development-only Swagger at `http://localhost:4000/api/docs`.

Values in `.env.example` are local placeholders. Replace every secret with a secret-manager generated value before deployment. Production startup requires `DATABASE_URL`, exact HTTPS `WEB_ORIGIN` entries, a unique 32+ character `AUTH_RATE_LIMIT_SECRET`, and a 32-byte hex `MFA_ENCRYPTION_KEY`. The web app currently does not call the API.

## Verification

```powershell
npm test
npm run db:validate
npm run build
```

These checks cover compilation, schema validity, API liveness and selected security primitives/access-control behavior. They do not certify database isolation under production concurrency, clinical safety, legal compliance, payment processing, backups or operational readiness.

## Deployment status

The connected Vercel project builds the Next.js app in `apps/web`. A Git push can deploy the updated website, but it does not host this NestJS API or provide its PostgreSQL database and secrets. Production API activation requires a separately configured API runtime, managed PostgreSQL, migration execution, secret provisioning, approved domain/origin configuration, monitoring and a security review. Do not connect real patient data until those are in place.

See [PRODUCT_SPEC.md](./PRODUCT_SPEC.md) for the full feature scope and implementation status.
