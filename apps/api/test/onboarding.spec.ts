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
