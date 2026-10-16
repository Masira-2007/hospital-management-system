import assert from "node:assert/strict";
import { ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { test } from "node:test";
import { AuthController } from "../src/auth/auth.controller";
import { hashPassword } from "../src/security/security.crypto";

const request = { headers: { "user-agent": "unit-test" }, ip: "127.0.0.1" };

test("patient login uses the patient membership mode and creates a persistent server-side session when requested", async () => {
  const passwordHash = await hashPassword("correct horse battery 927!");
  let createdSession: Record<string, unknown> | undefined;
  let cookie = "";
  const membership = {
    id: "member-patient",
    role: "PATIENT",
    department: null,
    organization: { id: "org-1", name: "JR Xpert Group", slug: "jr-xpert" },
    hospital: { id: "hospital-1", name: "City Hospital" },
    branch: null,
  };
  const prisma = {
    authRateLimit: {
      findUnique: async () => null,
      upsert: async () => ({ failedAttempts: 1 }),
      deleteMany: async () => ({ count: 1 }),
    },
    user: { findUnique: async () => ({
      id: "user-1", email: "patient@example.test", displayName: "Patient", status: "ACTIVE", emailVerifiedAt: new Date(),
      passwordHash, mfaEnabled: false, mfaSecretEncrypted: null, mfaLastUsedCounter: null, memberships: [membership],
    }) },
    auditEvent: { create: async () => ({}) },
    $transaction: async (callback: (transaction: Record<string, unknown>) => Promise<unknown>) => callback({
      user: { updateMany: async () => ({ count: 1 }) },
      session: { create: async ({ data }: { data: Record<string, unknown> }) => {
        createdSession = data;
        return { id: "session-1", expiresAt: data.expiresAt };
      } },
      auditEvent: { create: async () => ({}) },
      authRateLimit: { deleteMany: async () => ({ count: 1 }) },
    }),
  };
  const controller = new AuthController(prisma as never, { isConfigured: () => false } as never);

  const response = await controller.login(
    { email: " PATIENT@example.test ", password: "correct horse battery 927!", mode: "PATIENT", rememberMe: true },
    request,
    { setHeader: (_name, value) => { cookie = value; } },
  );

  assert.equal(response.user.id, "user-1");
  assert.deepEqual(response.memberships.map(({ role }) => role), ["PATIENT"]);
  assert.equal(typeof createdSession?.tokenHash, "string");
  assert.notEqual(createdSession?.tokenHash, cookie.match(/=([a-f0-9]{64})/)?.[1]);
  assert.ok((createdSession?.expiresAt as Date).getTime() - Date.now() > 29 * 24 * 60 * 60 * 1000);
  assert.match(cookie, /^jrxpert_session=[a-f0-9]{64}; HttpOnly; Path=\/; SameSite=Strict; Max-Age=/);
});

test("password login rejects a patient account in hospital mode with a generic error", async () => {
  const passwordHash = await hashPassword("correct horse battery 927!");
  let failedAudit = false;
  const prisma = {
    authRateLimit: {
      findUnique: async () => null,
      upsert: async () => ({ failedAttempts: 1 }),
    },
    user: { findUnique: async () => ({
      id: "user-1", email: "patient@example.test", displayName: "Patient", status: "ACTIVE", emailVerifiedAt: new Date(),
      passwordHash, mfaEnabled: false, mfaSecretEncrypted: null, mfaLastUsedCounter: null,
      memberships: [{ id: "member", role: "PATIENT" }],
    }) },
    auditEvent: { create: async () => { failedAudit = true; return {}; } },
  };
  const controller = new AuthController(prisma as never, { isConfigured: () => false } as never);
  await assert.rejects(() => controller.login(
    { email: "patient@example.test", password: "correct horse battery 927!", mode: "HOSPITAL" },
    request,
    { setHeader: () => undefined },
  ), (error: unknown) => {
    assert.ok(error instanceof UnauthorizedException);
    assert.equal(error.getStatus(), 401);
    assert.equal(JSON.stringify(error.getResponse()).includes("patient@example.test"), false);
    return true;
  });
  assert.equal(failedAudit, true);
});

test("password recovery reports missing email configuration instead of pretending to send", async () => {
  const controller = new AuthController({} as never, { isConfigured: () => false } as never);
  await assert.rejects(() => controller.requestPasswordReset({ email: "patient@example.test" }, request), (error: unknown) => {
    assert.ok(error instanceof ServiceUnavailableException);
    assert.equal(error.getStatus(), 503);
    return true;
  });
});

test("password reset consumes a one-use token and safely rejects reuse", async () => {
  const initialReset = { id: "reset-1", userId: "user-1", usedAt: null, expiresAt: new Date(Date.now() + 60_000), user: { id: "user-1", status: "ACTIVE", emailVerifiedAt: new Date() } };
  let reset = initialReset;
  let passwordUpdated = false;
  let sessionsRevoked = false;
  const prisma = {
    authRateLimit: {
      findUnique: async () => null,
      upsert: async () => ({ failedAttempts: 1 }),
    },
    $transaction: async (callback: (transaction: Record<string, unknown>) => Promise<unknown>) => callback({
      passwordResetToken: {
        findUnique: async () => reset,
        updateMany: async () => { reset = { ...reset, usedAt: new Date() }; return { count: 1 }; },
      },
      user: { update: async () => { passwordUpdated = true; return {}; } },
      session: { updateMany: async () => { sessionsRevoked = true; return { count: 2 }; } },
      auditEvent: { create: async () => ({}) },
    }),
  };
  const controller = new AuthController(prisma as never, { isConfigured: () => false } as never);
  let clearedCookie = "";
  await controller.resetPassword({ token: "a".repeat(64), password: "a strong replacement 927!" }, request, { setHeader: (_name, value) => { clearedCookie = value; } });
  assert.equal(passwordUpdated, true);
  assert.equal(sessionsRevoked, true);
  assert.match(clearedCookie, /^jrxpert_session=; HttpOnly; Path=\/; SameSite=Strict; Max-Age=0/);
  await assert.rejects(() => controller.resetPassword({ token: "a".repeat(64), password: "another strong pass 927!" }, request, { setHeader: () => undefined }), (error: unknown) => {
    assert.ok(error instanceof UnauthorizedException);
    assert.equal(error.getStatus(), 401);
    return true;
  });
});

test("password reset rejects an expired token", async () => {
  const prisma = {
    authRateLimit: {
      findUnique: async () => null,
      upsert: async () => ({ failedAttempts: 1 }),
    },
    $transaction: async (callback: (transaction: Record<string, unknown>) => Promise<unknown>) => callback({
      passwordResetToken: {
        findUnique: async () => ({ id: "reset-old", usedAt: null, expiresAt: new Date(Date.now() - 1), user: { id: "user-1", status: "ACTIVE", emailVerifiedAt: new Date() } }),
        updateMany: async () => ({ count: 0 }),
      },
    }),
  };
  const controller = new AuthController(prisma as never, { isConfigured: () => false } as never);
  await assert.rejects(() => controller.resetPassword({ token: "b".repeat(64), password: "a strong replacement 927!" }, request, { setHeader: () => undefined }), (error: unknown) => {
    assert.ok(error instanceof UnauthorizedException);
    assert.equal(error.getStatus(), 401);
    return true;
  });
});
