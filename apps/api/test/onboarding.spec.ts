import assert from "node:assert/strict";
import { BadRequestException, ForbiddenException, ServiceUnavailableException } from "@nestjs/common";
import { test } from "node:test";
import { HospitalApplicationsController } from "../src/applications/hospital-applications.controller.mjs";
import { HospitalInvitationsController } from "../src/applications/hospital-invitations.controller.mjs";
import { PlatformBootstrapController } from "../src/applications/platform-bootstrap.controller.mjs";
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
