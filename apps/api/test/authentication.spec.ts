import assert from "node:assert/strict";
import { ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { test } from "node:test";
import { AuthController } from "../src/auth/auth.controller.mjs";
import { hashEmailVerificationCode, hashPassword } from "../src/security/security.crypto.mjs";

const request = { headers: { "user-agent": "unit-test" }, ip: "127.0.0.1" };

test("patient login sends a one-time email code and creates a 12-hour session only after code verification", async () => {
  const passwordHash = await hashPassword("correct horse battery 927!");
  let createdSession: Record<string, unknown> | undefined;
  let cookie = "";
  let sentCode = "";
  let storedChallenge: Record<string, unknown> | undefined;
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
    loginVerificationCode: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        storedChallenge = { ...data, id: "challenge-1", failedAttempts: 0, usedAt: null };
        return { id: "challenge-1" };
      },
      findUnique: async () => storedChallenge,
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        storedChallenge = { ...storedChallenge, ...data, usedAt: data.usedAt ?? (storedChallenge?.usedAt ?? null) };
        return { count: 1 };
      },
    },
    auditEvent: { create: async () => ({}) },
    $transaction: async (callback: (transaction: Record<string, unknown>) => Promise<unknown>) => callback({
      loginVerificationCode: { updateMany: async () => {
        storedChallenge = { ...storedChallenge, usedAt: new Date() };
        return { count: 1 };
      } },
      session: { create: async ({ data }: { data: Record<string, unknown> }) => {
        createdSession = data;
        return { id: "session-1", expiresAt: data.expiresAt };
      } },
      auditEvent: { create: async () => ({}) },
      authRateLimit: { deleteMany: async () => ({ count: 1 }) },
    }),
  };
  const controller = new AuthController(prisma as never, {
    isEmailDeliveryConfigured: () => true,
    sendLoginVerificationCode: async (_email: string, code: string) => { sentCode = code; },
  } as never);

  const firstResponse = await controller.login(
    { email: " PATIENT@example.test ", password: "correct horse battery 927!", mode: "PATIENT" },
    request,
    { setHeader: (_name, value) => { cookie = value; } },
  );
  assert.equal(firstResponse.requiresEmailCode, true);
  assert.equal(firstResponse.emailHint, "p••••••@example.test");
  assert.equal(cookie, "");

  const response = await controller.login(
    { email: "patient@example.test", password: "correct horse battery 927!", mode: "PATIENT", challengeToken: firstResponse.challengeToken, emailCode: sentCode },
    request,
    { setHeader: (_name, value) => { cookie = value; } },
  );

  assert.equal(response.user.id, "user-1");
  assert.deepEqual(response.memberships.map(({ role }) => role), ["PATIENT"]);
  assert.equal(storedChallenge?.codeHash, hashEmailVerificationCode(sentCode));
  assert.ok(storedChallenge?.usedAt);
  assert.equal(typeof createdSession?.tokenHash, "string");
  assert.notEqual(createdSession?.tokenHash, cookie.match(/=([a-f0-9]{64})/)?.[1]);
  const remainingSessionMs = (createdSession?.expiresAt as Date).getTime() - Date.now();
  assert.ok(remainingSessionMs > 11 * 60 * 60 * 1000 && remainingSessionMs <= 12 * 60 * 60 * 1000);
  assert.match(cookie, /^jrxpert_session=[a-f0-9]{64}; HttpOnly; Path=\/; SameSite=Strict; Max-Age=/);
});

test("super-admin login uses email verification rather than requiring an authenticator code", async () => {
  const passwordHash = await hashPassword("correct horse battery 927!");
  let sentCode = "";
  let storedChallenge: Record<string, unknown> | undefined;
  const membership = { id: "member-admin", role: "SUPER_ADMIN", department: null, organization: { id: "org-1", name: "JR Xpert", slug: "jr-xpert" }, hospital: null, branch: null };
  const prisma = {
    authRateLimit: { findUnique: async () => null, upsert: async () => ({ failedAttempts: 1 }), deleteMany: async () => ({ count: 1 }) },
    user: { findUnique: async () => ({ id: "admin-1", email: "admin@example.test", displayName: "Admin", status: "ACTIVE", emailVerifiedAt: new Date(), passwordHash, mfaEnabled: true, mfaSecretEncrypted: "unused", mfaLastUsedCounter: null, memberships: [membership] }) },
    loginVerificationCode: {
      create: async ({ data }: { data: Record<string, unknown> }) => { storedChallenge = { ...data, id: "challenge-admin", failedAttempts: 0, usedAt: null }; return { id: "challenge-admin" }; },
      findUnique: async () => storedChallenge,
    },
    auditEvent: { create: async () => ({}) },
    $transaction: async (callback: (transaction: Record<string, any>) => Promise<unknown>) => callback({
      loginVerificationCode: { updateMany: async () => { storedChallenge = { ...storedChallenge, usedAt: new Date() }; return { count: 1 }; } },
      session: { create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "session-admin", expiresAt: data.expiresAt }) },
      auditEvent: { create: async () => ({}) }, authRateLimit: { deleteMany: async () => ({ count: 1 }) },
    }),
  };
  const controller = new AuthController(prisma as never, { isEmailDeliveryConfigured: () => true, sendLoginVerificationCode: async (_email: string, code: string) => { sentCode = code; } } as never);
  const challenge = await controller.login({ email: "admin@example.test", password: "correct horse battery 927!", mode: "SUPER_ADMIN" }, request, { setHeader: () => undefined });
  const result = await controller.login({ email: "admin@example.test", password: "correct horse battery 927!", mode: "SUPER_ADMIN", challengeToken: challenge.challengeToken, emailCode: sentCode }, request, { setHeader: () => undefined });
  assert.equal(challenge.requiresEmailCode, true);
  assert.equal(result.user.id, "admin-1");
  assert.equal(result.memberships[0].role, "SUPER_ADMIN");
});

test("login never reports a successful first step when email delivery is not configured", async () => {
  const passwordHash = await hashPassword("correct horse battery 927!");
  const prisma = {
    authRateLimit: { findUnique: async () => null, upsert: async () => ({ failedAttempts: 1 }) },
    user: { findUnique: async () => ({
      id: "user-1", email: "staff@example.test", displayName: "Staff", status: "ACTIVE", emailVerifiedAt: new Date(),
      passwordHash, memberships: [{ id: "member-1", role: "HOSPITAL_ADMIN" }],
    }) },
    loginVerificationCode: { create: async () => { throw new Error("a code must not be persisted without a sender"); } },
  };
  const controller = new AuthController(prisma as never, { isEmailDeliveryConfigured: () => false } as never);
  await assert.rejects(() => controller.login(
    { email: "staff@example.test", password: "correct horse battery 927!", mode: "HOSPITAL" }, request, { setHeader: () => undefined },
  ), (error: unknown) => error instanceof ServiceUnavailableException && error.getStatus() === 503);
});

test("an incorrect email code is rate-counted and cannot create a session", async () => {
  const passwordHash = await hashPassword("correct horse battery 927!");
  let sentCode = "";
  let storedChallenge: Record<string, unknown> | undefined;
  let failedAudit = false;
  let sessionCreated = false;
  const prisma = {
    authRateLimit: { findUnique: async () => null, upsert: async () => ({ failedAttempts: 1 }) },
    user: { findUnique: async () => ({ id: "user-1", email: "staff@example.test", displayName: "Staff", status: "ACTIVE", emailVerifiedAt: new Date(), passwordHash, memberships: [{ id: "member-1", role: "HOSPITAL_ADMIN", organization: { id: "org-1", name: "Hospital", slug: "hospital" }, hospital: null, branch: null }] }) },
    loginVerificationCode: {
      create: async ({ data }: { data: Record<string, unknown> }) => { storedChallenge = { ...data, id: "challenge-1", failedAttempts: 0, usedAt: null }; return { id: "challenge-1" }; },
      findUnique: async () => storedChallenge,
      updateMany: async () => { storedChallenge = { ...storedChallenge, failedAttempts: 1 }; return { count: 1 }; },
    },
    auditEvent: { create: async () => { failedAudit = true; return {}; } },
    $transaction: async () => { throw new Error("an invalid code must never create a session"); },
  };
  const controller = new AuthController(prisma as never, { isEmailDeliveryConfigured: () => true, sendLoginVerificationCode: async (_email: string, code: string) => { sentCode = code; } } as never);
  const challenge = await controller.login({ email: "staff@example.test", password: "correct horse battery 927!", mode: "HOSPITAL" }, request, { setHeader: () => undefined });
  const invalidCode = sentCode === "999999" ? "999998" : "999999";
  await assert.rejects(() => controller.login({ email: "staff@example.test", password: "correct horse battery 927!", mode: "HOSPITAL", challengeToken: challenge.challengeToken, emailCode: invalidCode }, request, { setHeader: () => { sessionCreated = true; } }), (error: unknown) => error instanceof UnauthorizedException && error.getStatus() === 401);
  assert.equal(failedAudit, true);
  assert.equal(sessionCreated, false);
  assert.equal(storedChallenge?.failedAttempts, 1);
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
