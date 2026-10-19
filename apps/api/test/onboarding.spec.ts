import assert from "node:assert/strict";
import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException } from "@nestjs/common";
import { test } from "node:test";
import { HospitalApplicationsController } from "../src/applications/hospital-applications.controller.mjs";
import { HospitalInvitationsController } from "../src/applications/hospital-invitations.controller.mjs";
import { PlatformBootstrapController } from "../src/applications/platform-bootstrap.controller.mjs";
import { PlatformController } from "../src/applications/platform.controller.mjs";
import { PlatformAuditQueryDto, PlatformHospitalQueryDto } from "../src/applications/platform-hospital.dto.mjs";
import { SuperAdminGuard } from "../src/auth/super-admin.guard.mjs";
import { hashSessionToken } from "../src/security/security.crypto.mjs";

const request = { headers: { origin: "http://localhost:3000" }, ip: "127.0.0.1" };

test("hospital application does not claim to send a verification email when email delivery is not configured", async () => {
  const controller = new HospitalApplicationsController({} as never, { isConfigured: () => false } as never);
  await assert.rejects(() => controller.submit({} as never, request), (error: unknown) => {
    assert.ok(error instanceof ServiceUnavailableException);
    assert.equal(error.getStatus(), 503);
    return true;
  });
});

test("parallel hospital submissions for one official email are serialized to one application", async () => {
  const applications: Array<Record<string, unknown>> = [];
  const lockTails = new Map<string, Promise<void>>();
  let nextId = 1;
  let emailsSent = 0;

  async function acquireLock(key: string) {
    const previous = lockTails.get(key) ?? Promise.resolve();
    let unlock = () => undefined;
    const held = new Promise<void>((resolve) => { unlock = resolve; });
    const current = previous.then(() => held);
    lockTails.set(key, current);
    await previous;
    return () => {
      unlock();
      if (lockTails.get(key) === current) lockTails.delete(key);
    };
  }

  const prisma = {
    $queryRaw: async () => [{ failedAttempts: 1 }],
    $transaction: async (callback: (transaction: Record<string, unknown>) => Promise<unknown>) => {
      let release: (() => void) | undefined;
      try {
        return await callback({
          $queryRaw: async (query: TemplateStringsArray, ...values: unknown[]) => {
            if (query.join("").includes("pg_advisory_xact_lock")) release = await acquireLock(String(values[0]));
            return [];
          },
          hospitalApplication: {
            findFirst: async ({ where }: { where: { officialEmail: string } }) => {
              // Yield so an implementation that omits the lock exposes the race.
              await Promise.resolve();
              return applications.find((application) => application.officialEmail === where.officialEmail) ?? null;
            },
            create: async ({ data }: { data: Record<string, unknown> }) => {
              const created = { id: `application-${nextId++}`, ...data };
              applications.push(created);
              return { id: created.id, status: created.status };
            },
            update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
              const existing = applications.find((application) => application.id === where.id)!;
              Object.assign(existing, data);
              return { id: existing.id, status: existing.status };
            },
          },
          auditEvent: { create: async () => undefined },
        });
      } finally {
        release?.();
      }
    },
  };
  const controller = new HospitalApplicationsController(prisma as never, {
    isConfigured: () => true,
    sendHospitalApplicationVerification: async () => { emailsSent += 1; },
  } as never);
  const application = {
    hospitalName: "Example Hospital", hospitalType: "GENERAL", officialEmail: "apply@example.test",
    contactPhone: "+911234567890", streetAddress: "123 Care Road", city: "Ahmedabad", state: "Gujarat",
    country: "India", postalCode: "380001", bedCount: 100, branchCount: 1,
    representativeName: "A. Representative", representativeDesignation: "Director",
    proposedAdminName: "Hospital Admin", proposedAdminEmail: "admin@example.test", termsAccepted: true,
  };

  await Promise.all([
    controller.submit(application as never, request),
    controller.submit(application as never, request),
  ]);

  assert.equal(applications.length, 1);
  assert.equal(emailsSent, 1, "duplicate submissions do not rotate an in-flight verification token");
  assert.equal(applications[0].officialEmail, "apply@example.test");
});

test("application verification consumes a one-time token and rejects its replay", async () => {
  const token = "a".repeat(64);
  let usable = true;
  let auditCount = 0;
  const application = { id: "application-1", status: "EMAIL_PENDING", verificationExpiresAt: new Date(Date.now() + 60_000) };
  const prisma = {
    $queryRaw: async () => [{ failedAttempts: 1 }],
    $transaction: async (callback: (transaction: Record<string, unknown>) => Promise<unknown>) => callback({
      hospitalApplication: {
        findUnique: async () => usable ? application : null,
        updateMany: async () => { if (!usable) return { count: 0 }; usable = false; return { count: 1 }; },
      },
      auditEvent: { create: async () => { auditCount += 1; } },
    }),
  };
  const controller = new HospitalApplicationsController(prisma as never, {} as never);
  const verified = await controller.verifyEmail({ token }, request);
  assert.match(verified.message, /verified/i);
  assert.equal(auditCount, 1);
  await assert.rejects(() => controller.verifyEmail({ token }, request), (error: unknown) => error instanceof BadRequestException);
  assert.equal(auditCount, 1, "the replay does not add a second verification audit");
  assert.equal(hashSessionToken(token).length, 64, "only a token hash is used to look up the record");
});

test("invitation setup rejects an unsent or revoked invitation before creating an account", async () => {
  let userCreated = false;
  const prisma = {
    $queryRaw: async () => [{ failedAttempts: 1 }],
    hospitalInvitation: { findUnique: async () => ({
      id: "invite-1", organizationId: "org-1", hospitalId: "hospital-1", intendedEmail: "admin@example.test", role: "HOSPITAL_ADMIN",
      status: "PENDING", deliveryStatus: "FAILED", expiresAt: new Date(Date.now() + 60_000), preparedAt: null, hospital: { status: "PROVISIONING" },
    }) },
    user: { create: async () => { userCreated = true; } },
  };
  const controller = new HospitalInvitationsController(prisma as never);
  await assert.rejects(() => controller.prepare({ token: "b".repeat(64), displayName: "Admin", password: "a strong password 928!" }, request), (error: unknown) => error instanceof BadRequestException);
  assert.equal(userCreated, false);
});

test("hospital invitation setup link cannot prepare the account twice", async () => {
  let transactions = 0;
  const prisma = {
    $queryRaw: async () => [{ failedAttempts: 1 }],
    hospitalInvitation: { findUnique: async () => ({
      id: "invite-1", organizationId: "org-1", hospitalId: "hospital-1", intendedEmail: "admin@example.test", role: "HOSPITAL_ADMIN",
      status: "PENDING", deliveryStatus: "SENT", expiresAt: new Date(Date.now() + 60_000), preparedAt: new Date(), hospital: { status: "PROVISIONING" },
    }) },
    $transaction: async () => { transactions += 1; },
  };
  const controller = new HospitalInvitationsController(prisma as never);
  await assert.rejects(() => controller.prepare({ token: "d".repeat(64), displayName: "Admin", password: "a strong password 928!" }, request), (error: unknown) => error instanceof BadRequestException);
  assert.equal(transactions, 0);
});

test("concurrent hospital invitation setup can claim the preparation token only once", async () => {
  let userCreated = false;
  let claimWhere: unknown;
  const expiresAt = new Date(Date.now() + 60_000);
  const prisma = {
    $queryRaw: async () => [{ failedAttempts: 1 }],
    hospitalInvitation: { findUnique: async () => ({
      id: "invite-1", organizationId: "org-1", hospitalId: "hospital-1", intendedEmail: "admin@example.test", role: "HOSPITAL_ADMIN",
      status: "PENDING", deliveryStatus: "SENT", expiresAt, preparedAt: null, hospital: { status: "PROVISIONING" },
    }) },
    user: { findUnique: async () => null },
    $transaction: async (callback: (transaction: Record<string, unknown>) => Promise<unknown>) => callback({
      hospitalInvitation: {
        findUnique: async () => ({ status: "PENDING", deliveryStatus: "SENT", expiresAt, preparedAt: new Date() }),
        updateMany: async ({ where }: { where: unknown }) => { claimWhere = where; return { count: 0 }; },
      },
      user: { create: async () => { userCreated = true; } },
    }),
  };
  const controller = new HospitalInvitationsController(prisma as never);
  const previousKey = process.env.MFA_ENCRYPTION_KEY;
  process.env.MFA_ENCRYPTION_KEY = "ab".repeat(32);
  try {
    await assert.rejects(() => controller.prepare({ token: "e".repeat(64), displayName: "Admin", password: "a strong password 928!" }, request), (error: unknown) => error instanceof BadRequestException);
  } finally {
    if (previousKey === undefined) delete process.env.MFA_ENCRYPTION_KEY;
    else process.env.MFA_ENCRYPTION_KEY = previousKey;
  }
  const claim = claimWhere as { id: string; status: string; deliveryStatus: string; preparedAt: Date | null; expiresAt: { gt: Date } };
  assert.equal(claim.id, "invite-1");
  assert.equal(claim.status, "PENDING");
  assert.equal(claim.deliveryStatus, "SENT");
  assert.equal(claim.preparedAt, null);
  assert.ok(claim.expiresAt.gt instanceof Date);
  assert.equal(userCreated, false);
});

test("first platform admin cannot be activated without a valid MFA code", async () => {
  let mutations = 0;
  const prisma = {
    $queryRaw: async () => [{ failedAttempts: 1 }],
    platformBootstrapToken: { findUnique: async () => ({
      id: "bootstrap-1", userId: "admin-1", tokenHash: hashSessionToken("c".repeat(64)), expiresAt: new Date(Date.now() + 60_000), preparedAt: new Date(), usedAt: null,
      user: { id: "admin-1", status: "INVITED", mfaEnabled: false, mfaSecretEncrypted: "invalid-encrypted-secret", mfaLastUsedCounter: null },
    }) },
    membership: { findFirst: async () => ({ id: "membership-1", organizationId: "org-platform" }) },
    $transaction: async () => { mutations += 1; },
  };
  const controller = new PlatformBootstrapController(prisma as never);
  await assert.rejects(() => controller.complete({ token: "c".repeat(64), mfaCode: "123456" }, request), (error: unknown) => error instanceof ForbiddenException);
  assert.equal(mutations, 0);
});

test("first platform admin bootstrap setup link cannot be prepared twice", async () => {
  let transactions = 0;
  const prisma = {
    $queryRaw: async () => [{ failedAttempts: 1 }],
    platformBootstrapToken: { findUnique: async () => ({
      id: "bootstrap-1", userId: "admin-1", tokenHash: hashSessionToken("f".repeat(64)), expiresAt: new Date(Date.now() + 60_000), preparedAt: new Date(), usedAt: null,
      user: { id: "admin-1", email: "admin@example.test", status: "INVITED", mfaEnabled: false },
    }) },
    $transaction: async () => { transactions += 1; },
  };
  const controller = new PlatformBootstrapController(prisma as never);
  await assert.rejects(() => controller.prepare({ token: "f".repeat(64), displayName: "Platform Admin", password: "a strong password 928!" }, request), (error: unknown) => error instanceof BadRequestException);
  assert.equal(transactions, 0);
});

test("concurrent first-admin setup can claim its preparation token only once", async () => {
  let userUpdated = false;
  let claimWhere: unknown;
  const prisma = {
    $queryRaw: async () => [{ failedAttempts: 1 }],
    platformBootstrapToken: { findUnique: async () => ({
      id: "bootstrap-1", userId: "admin-1", tokenHash: hashSessionToken("g".repeat(64)), expiresAt: new Date(Date.now() + 60_000), preparedAt: null, usedAt: null,
      user: { id: "admin-1", email: "admin@example.test", status: "INVITED", mfaEnabled: false },
    }) },
    membership: { findFirst: async () => ({ id: "membership-1", organizationId: "org-platform" }) },
    $transaction: async (callback: (transaction: Record<string, unknown>) => Promise<unknown>) => callback({
      platformBootstrapToken: { updateMany: async ({ where }: { where: unknown }) => { claimWhere = where; return { count: 0 }; } },
      user: { update: async () => { userUpdated = true; } },
    }),
  };
  const controller = new PlatformBootstrapController(prisma as never);
  const previousKey = process.env.MFA_ENCRYPTION_KEY;
  process.env.MFA_ENCRYPTION_KEY = "cd".repeat(32);
  try {
    await assert.rejects(() => controller.prepare({ token: "g".repeat(64), displayName: "Platform Admin", password: "a strong password 928!" }, request), (error: unknown) => error instanceof BadRequestException);
  } finally {
    if (previousKey === undefined) delete process.env.MFA_ENCRYPTION_KEY;
    else process.env.MFA_ENCRYPTION_KEY = previousKey;
  }
  const claim = claimWhere as { id: string; usedAt: Date | null; preparedAt: Date | null; expiresAt: { gt: Date } };
  assert.equal(claim.id, "bootstrap-1");
  assert.equal(claim.usedAt, null);
  assert.equal(claim.preparedAt, null);
  assert.ok(claim.expiresAt.gt instanceof Date);
  assert.equal(userUpdated, false);
});

test("platform routes require MFA and an active platform-scoped administrator membership", async () => {
  const guard = new SuperAdminGuard({
    user: { findUnique: async () => ({ mfaEnabled: true }) },
    membership: { findFirst: async () => null },
  } as never);
  const context = { switchToHttp: () => ({ getRequest: () => ({ authSession: { user: { id: "user-1" } } }) }) } as never;
  await assert.rejects(() => guard.canActivate(context), (error: unknown) => error instanceof ForbiddenException);
});

test("hospital suspension is audited and repeated requests are idempotent", async () => {
  let status = "ACTIVE";
  let auditCount = 0;
  const prisma = {
    $transaction: async (callback: (transaction: Record<string, unknown>) => Promise<unknown>) => callback({
      hospital: {
        findUnique: async () => ({ id: "hospital-1", organizationId: "org-1", name: "Example Hospital", status }),
        updateMany: async ({ data }: { data: { status: string } }) => { status = data.status; return { count: 1 }; },
      },
      auditEvent: { create: async () => { auditCount += 1; } },
    }),
  };
  const controller = new PlatformController(prisma as never, {} as never);
  const request = { authSession: { user: { id: "admin-1" } } } as never;
  const first = await controller.changeHospitalStatus("hospital-1", { action: "SUSPEND", reason: "Security review requires temporary suspension." }, request);
  const repeated = await controller.changeHospitalStatus("hospital-1", { action: "SUSPEND", reason: "Security review requires temporary suspension." }, request);
  assert.deepEqual(first, { hospital: { id: "hospital-1", name: "Example Hospital", status: "SUSPENDED" }, changed: true });
  assert.deepEqual(repeated, { hospital: { id: "hospital-1", name: "Example Hospital", status: "SUSPENDED" }, changed: false });
  assert.equal(auditCount, 1, "idempotent retry does not create duplicate audit events");
});

test("provisioning hospitals cannot be suspended or reactivated from the platform status route", async () => {
  let auditCount = 0;
  const prisma = {
    $transaction: async (callback: (transaction: Record<string, unknown>) => Promise<unknown>) => callback({
      hospital: { findUnique: async () => ({ id: "hospital-1", organizationId: "org-1", name: "Example Hospital", status: "PROVISIONING" }) },
      auditEvent: { create: async () => { auditCount += 1; } },
    }),
  };
  const controller = new PlatformController(prisma as never, {} as never);
  await assert.rejects(
    () => controller.changeHospitalStatus("hospital-1", { action: "SUSPEND", reason: "Security review requires temporary suspension." }, { authSession: { user: { id: "admin-1" } } } as never),
    (error: unknown) => error instanceof ConflictException,
  );
  assert.equal(auditCount, 0);
});

test("platform hospital search is paginated and returns only operational metadata", async () => {
  let findArgs: Record<string, unknown> | undefined;
  let countWhere: unknown;
  const hospital = {
    id: "hospital-1", name: "North Clinic", slug: "north-clinic", status: "ACTIVE", createdAt: new Date(0),
    organization: { id: "org-1", name: "North Health", status: "ACTIVE" },
    _count: { branches: 2, memberships: 7 },
    subscriptions: [],
  };
  const prisma = {
    hospital: {
      count: async ({ where }: { where: unknown }) => { countWhere = where; return 1; },
      findMany: async (args: Record<string, unknown>) => { findArgs = args; return [hospital]; },
    },
  };
  const query = Object.assign(new PlatformHospitalQueryDto(), { page: 2, pageSize: 20, search: " North ", status: "ACTIVE" as const });
  const result = await new PlatformController(prisma as never, {} as never).listHospitals(query);
  assert.equal((findArgs?.skip), 20);
  assert.equal((findArgs?.take), 20);
  assert.deepEqual(countWhere, findArgs?.where);
  assert.equal(result.pagination.total, 1);
  assert.equal(result.pagination.pages, 1);
  assert.equal(result.hospitals[0].name, "North Clinic");
  assert.equal("patients" in result.hospitals[0], false);
});

test("platform system health reports database and email setup without exposing secrets", async () => {
  const controller = new PlatformController({ $queryRaw: async () => [{ ready: 1 }] } as never, { isConfigured: () => false } as never);
  const result = await controller.systemHealth();
  assert.equal(result.status, "degraded");
  assert.deepEqual(result.checks, { database: "connected", emailDelivery: "needs_setup" });
  assert.ok(Number.isFinite(Date.parse(result.checkedAt)));
  assert.equal(JSON.stringify(result).includes("RESEND_API_KEY"), false);
  assert.equal(JSON.stringify(result).includes("DATABASE_URL"), false);
});

test("platform system health degrades safely when PostgreSQL is unavailable", async () => {
  const controller = new PlatformController({ $queryRaw: async () => { throw new Error("database credentials leaked"); } } as never, { isConfigured: () => true } as never);
  const result = await controller.systemHealth();
  assert.equal(result.status, "degraded");
  assert.deepEqual(result.checks, { database: "unavailable", emailDelivery: "configured" });
  assert.equal(JSON.stringify(result).includes("credentials"), false);
});

test("platform audit review is paginated, scoped by safe filters, and omits event metadata", async () => {
  let findArgs: Record<string, unknown> | undefined;
  let countWhere: unknown;
  let auditEntry: unknown;
  const event = {
    id: "event-1", actorUserId: "admin-1", action: "hospital.application_approved", resourceType: "hospital_application",
    resourceId: "application-1", createdAt: new Date(0), actor: { displayName: "Platform Admin" },
    organization: { id: "org-1", name: "Example Organization" },
  };
  const prisma = {
    $transaction: async (callback: (transaction: Record<string, unknown>) => Promise<unknown>) => callback({
      auditEvent: {
        count: async ({ where }: { where: unknown }) => { countWhere = where; return 1; },
        findMany: async (args: Record<string, unknown>) => { findArgs = args; return [event]; },
        create: async ({ data }: { data: unknown }) => { auditEntry = data; },
      },
    }),
  };
  const query = Object.assign(new PlatformAuditQueryDto(), {
    action: "hospital.application_approved", organizationId: "org-1", page: 2, pageSize: 10,
    from: "2026-01-01T00:00:00.000Z", to: "2026-02-01T00:00:00.000Z",
  });
  const result = await new PlatformController(prisma as never, {} as never).listAuditEvents(query, { authSession: { user: { id: "admin-1" } } } as never);
  assert.equal(findArgs?.skip, 10);
  assert.equal(findArgs?.take, 10);
  assert.deepEqual(countWhere, findArgs?.where);
  assert.deepEqual(countWhere, {
    resourceType: { not: "patient_directory" },
    action: "hospital.application_approved", organizationId: "org-1",
    createdAt: { gte: new Date(query.from), lte: new Date(query.to) },
  });
  assert.equal(result.pagination.total, 1);
  assert.equal(result.events[0].action, event.action);
  assert.equal("metadata" in result.events[0], false);
  assert.equal("email" in result.events[0].actor!, false);
  assert.equal((auditEntry as { action: string }).action, "platform.audit_events_listed");
});

test("platform audit feed excludes hospital-scoped patient directory trails", async () => {
  let findArgs: Record<string, unknown> | undefined;
  const prisma = {
    $transaction: async (callback: (transaction: Record<string, unknown>) => Promise<unknown>) => callback({
      auditEvent: {
        count: async () => 0,
        findMany: async (args: Record<string, unknown>) => { findArgs = args; return []; },
        create: async () => undefined,
      },
    }),
  };
  const query = Object.assign(new PlatformAuditQueryDto(), { page: 1, pageSize: 25 });
  await new PlatformController(prisma as never, {} as never).listAuditEvents(query, { authSession: { user: { id: "admin-1" } } } as never);
  assert.deepEqual(findArgs?.where, { resourceType: { not: "patient_directory" } });
});

test("platform audit review rejects reversed date ranges before querying", async () => {
  let transactions = 0;
  const controller = new PlatformController({ $transaction: async () => { transactions += 1; } } as never, {} as never);
  const query = Object.assign(new PlatformAuditQueryDto(), { from: "2026-02-01T00:00:00.000Z", to: "2026-01-01T00:00:00.000Z" });
  await assert.rejects(() => controller.listAuditEvents(query, request as never), (error: unknown) => error instanceof BadRequestException);
  assert.equal(transactions, 0);
});
