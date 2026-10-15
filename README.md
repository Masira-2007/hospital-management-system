# JR Xpert HMS

**Better Care. Smarter Management. Healthier Tomorrow.**

JR Xpert HMS is being developed as a multi-hospital healthcare platform. This repository is the first product increment, not a production-ready hospital system. The included web workspace is a responsive visual preview with fictional records; it has no sign-in, live patient data, or write operations. The API currently exposes process health only.

## Current increment

- Responsive hospital operations dashboard inspired by the supplied reference image.
- Public JR Xpert product page with a responsive, fictional dashboard illustration.
- Patient directory preview with client-side search and status filters.
- Appointment schedule preview and explicit planned-module states.
- JR Xpert vector mark, navy/teal design tokens, keyboard focus styles, reduced-motion support, and responsive layouts.
- NestJS API foundation with versioned URL prefix, security headers, strict validation defaults, CORS allowlist configuration, health endpoint, and OpenAPI page.
- PostgreSQL Prisma contract for organizations, hospitals, branches, memberships, patients, appointments, and audit events.
- Local PostgreSQL and Redis containers for later backend work.

The browser uses synthetic example records to make the visual preview understandable. Do not enter real patient information. There is no authentication, tenant-membership check, row-level security policy, clinical record API, payment provider, messaging provider, or mobile application yet. The data contract alone does not enforce tenant isolation; tenant-scoped query enforcement and database policies are required before data endpoints are added.

## Run locally

Requirements: Node.js 24.15 or newer and npm. The runtime in this workspace is Node 24.19.

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

The web preview runs at `http://localhost:3000`, the API health endpoint at `http://localhost:4000/api/v1/health`, and the API documentation at `http://localhost:4000/api/docs`.

Start local data services separately when needed:

```powershell
docker compose up -d postgres redis
npm run db:generate
npm run db:validate
```

The current dashboard does not connect to those services. Database URL and signing-key values in `.env.example` are development placeholders only. Replace them with secret-managed values before any deployed environment.

## Verify

```powershell
npm test
npm run build
```

The API unit test covers only the liveness response. A green build or health response does not certify clinical workflows, tenant isolation, privacy, security, payments, or production readiness.

## Architecture and scope

See [PRODUCT_SPEC.md](./PRODUCT_SPEC.md) for the tracked feature scope and implementation status. The intended direction is a Next.js/React/TypeScript web client, NestJS modular API, PostgreSQL/Prisma, Redis-backed jobs, and Expo mobile client. The technology versions are recorded in the workspace lockfile after dependency installation.
