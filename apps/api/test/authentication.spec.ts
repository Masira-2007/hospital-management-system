import assert from "node:assert/strict";
import { ForbiddenException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
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
      $queryRaw: async (query: TemplateStringsArray, ...values: unknown[]) => {
        assert.match(query.join(""), /FOR UPDATE/);
        assert.deepEqual(values, ["user-1"]);
        return [{ id: "user-1" }];
      },
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
  assert.equal(createdSession?.activeMembershipId, "member-patient");
  assert.equal(typeof createdSession?.tokenHash, "string");
  assert.notEqual(createdSession?.tokenHash, cookie.match(/=([a-f0-9]{64})/)?.[1]);
  const remainingSessionMs = (createdSession?.expiresAt as Date).getTime() - Date.now();
  assert.ok(remainingSessionMs > 11 * 60 * 60 * 1000 && remainingSessionMs <= 12 * 60 * 60 * 1000);
  assert.match(cookie, /^jrxpert_session=[a-f0-9]{64}; HttpOnly; Path=\/; SameSite=Strict; Max-Age=/);
});

test("account suspension between email code delivery and login blocks session creation", async () => {
  const passwordHash = await hashPassword("correct horse battery 927!");
  let sentCode = "";
  let challenge: Record<string, unknown> | undefined;
  let sessionCreated = false;
  let failureAudited = false;
  const prisma = {
    authRateLimit: { findUnique: async () => null, upsert: async () => ({ failedAttempts: 1 }) },
    user: { findUnique: async () => ({ id: "staff-1", email: "staff@example.test", displayName: "Staff", status: "ACTIVE", emailVerifiedAt: new Date(), passwordHash, memberships: [{ id: "member-1", role: "HOSPITAL_ADMIN" }] }) },
    loginVerificationCode: {
      create: async ({ data }: { data: Record<string, unknown> }) => { challenge = { ...data, id: "challenge-1", failedAttempts: 0, usedAt: null }; return { id: "challenge-1" }; },
      findUnique: async () => challenge,
      updateMany: async () => { throw new Error("suspended account must not consume or create a session from this code"); },
    },
    auditEvent: { create: async ({ data }: { data: { action: string } }) => { if (data.action === "auth.login_failed") failureAudited = true; return {}; } },
    $transaction: async (callback: (transaction: Record<string, unknown>) => Promise<unknown>) => callback({
      $queryRaw: async (query: TemplateStringsArray) => { assert.match(query.join(""), /FOR UPDATE/); return []; },
      loginVerificationCode: { updateMany: async () => { throw new Error("a consumed code must not reach this step"); } },
      session: { create: async () => { sessionCreated = true; throw new Error("session must not be created"); } },
      auditEvent: { create: async () => ({}) }, authRateLimit: { deleteMany: async () => ({ count: 0 }) },
    }),
  };
  const controller = new AuthController(prisma as never, { isEmailDeliveryConfigured: () => true, sendLoginVerificationCode: async (_email: string, code: string) => { sentCode = code; } } as never);
  const firstStep = await controller.login({ email: "staff@example.test", password: "correct horse battery 927!", mode: "HOSPITAL" }, request, { setHeader: () => undefined });
  await assert.rejects(() => controller.login({ email: "staff@example.test", password: "correct horse battery 927!", mode: "HOSPITAL", challengeToken: firstStep.challengeToken, emailCode: sentCode }, request, { setHeader: () => undefined }), (error: unknown) => error instanceof UnauthorizedException);
  assert.equal(sessionCreated, false);
  assert.equal(failureAudited, true);
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
      $queryRaw: async (query: TemplateStringsArray, ...values: unknown[]) => {
        assert.match(query.join(""), /FOR UPDATE/);
        assert.deepEqual(values, ["admin-1"]);
        return [{ id: "admin-1" }];
      },
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

test("session management lists only the authenticated account's active sessions without token hashes", async () => {
  let query: Record<string, any> | undefined;
  const sessions = [
    { id: "session-current", userAgent: "test device", createdAt: new Date(), lastUsedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) },
    { id: "session-other", userAgent: null, createdAt: new Date(), lastUsedAt: null, expiresAt: new Date(Date.now() + 60_000) },
  ];
  const controller = new AuthController({
    session: { findMany: async (args: Record<string, any>) => { query = args; return sessions; } },
  } as never, {} as never);
  const result = await controller.listSessions({
    ...request,
    authSession: { id: "session-current", user: { id: "user-1", email: "admin@example.test", displayName: "Admin" } },
  });

  assert.equal(query?.where.userId, "user-1");
  assert.equal(query?.where.revokedAt, null);
  assert.ok(query?.where.expiresAt.gt instanceof Date);
  assert.equal(query?.take, 50);
  assert.deepEqual(query?.select, { id: true, userAgent: true, createdAt: true, lastUsedAt: true, expiresAt: true });
  assert.deepEqual(result.sessions.map(({ id, current }) => ({ id, current })), [
    { id: "session-current", current: true },
    { id: "session-other", current: false },
  ]);
  assert.equal(Object.hasOwn(result.sessions[0], "tokenHash"), false);
});

test("membership selection is verified for the signed-in user, persisted per session, and audited", async () => {
  let membershipQuery: Record<string, any> | undefined;
  let sessionUpdate: Record<string, any> | undefined;
  let audit: Record<string, any> | undefined;
  const controller = new AuthController({
    $transaction: async (callback: (transaction: Record<string, any>) => Promise<unknown>) => callback({
      membership: { findFirst: async ({ where }: { where: Record<string, any> }) => { membershipQuery = where; return { id: "member-1", organizationId: "org-1" }; } },
      session: { updateMany: async (args: Record<string, any>) => { sessionUpdate = args; return { count: 1 }; } },
      auditEvent: { create: async ({ data }: { data: Record<string, any> }) => { audit = data; return {}; } },
    }),
  } as never, {} as never);
  const result = await controller.selectMembership({ membershipId: "member-1" }, {
    ...request,
    authSession: { id: "session-1", user: { id: "user-1", email: "staff@example.test", displayName: "Staff" } },
  });

  assert.deepEqual(membershipQuery, {
    id: "member-1",
    userId: "user-1",
    status: "ACTIVE",
    OR: [{ expiresAt: null }, { expiresAt: { gt: membershipQuery?.OR?.[1]?.expiresAt?.gt } }],
    organization: { status: "ACTIVE" },
    AND: [
      { OR: [{ hospitalId: null }, { hospital: { is: { status: "ACTIVE" } } }] },
      { OR: [{ branchId: null }, { branch: { is: { status: "ACTIVE" } } }] },
    ],
  });
  assert.ok(membershipQuery?.OR?.[1]?.expiresAt?.gt instanceof Date);
  assert.deepEqual(sessionUpdate?.where, { id: "session-1", userId: "user-1", revokedAt: null, expiresAt: { gt: sessionUpdate?.where.expiresAt.gt } });
  assert.ok(sessionUpdate?.where.expiresAt.gt instanceof Date);
  assert.deepEqual(sessionUpdate?.data, { activeMembershipId: "member-1" });
  assert.deepEqual(audit, { organizationId: "org-1", actorUserId: "user-1", action: "auth.membership_selected", resourceType: "membership", resourceId: "member-1" });
  assert.deepEqual(result, { selectedMembershipId: "member-1" });
});

test("membership selection rejects a membership owned by a different account", async () => {
  let updated = false;
  const controller = new AuthController({
    $transaction: async (callback: (transaction: Record<string, any>) => Promise<unknown>) => callback({
      membership: { findFirst: async () => null },
      session: { updateMany: async () => { updated = true; return { count: 1 }; } },
      auditEvent: { create: async () => ({}) },
    }),
  } as never, {} as never);
  await assert.rejects(() => controller.selectMembership({ membershipId: "foreign-member" }, {
    ...request,
    authSession: { id: "session-1", user: { id: "user-1", email: "staff@example.test", displayName: "Staff" } },
  }), (error: unknown) => error instanceof ForbiddenException && error.getStatus() === 403);
  assert.equal(updated, false);
});

test("session revocation is constrained to the authenticated account and audited", async () => {
  let update: Record<string, any> | undefined;
  let transactions = 0;
  const auditEvents: Array<Record<string, any>> = [];
  const controller = new AuthController({
    $transaction: async (callback: (transaction: Record<string, any>) => Promise<unknown>) => {
      transactions += 1;
      return callback({
        session: { updateMany: async (args: Record<string, any>) => { update = args; return { count: 1 }; } },
        auditEvent: { create: async ({ data }: { data: Record<string, any> }) => { auditEvents.push(data); return {}; } },
      });
    },
  } as never, {} as never);
  await controller.revokeSession("session-foreign", {
    ...request,
    authSession: { id: "session-current", user: { id: "user-1", email: "admin@example.test", displayName: "Admin" } },
  });

  assert.deepEqual(update?.where, { id: "session-foreign", userId: "user-1", revokedAt: null });
  assert.ok(update?.data.revokedAt instanceof Date);
  assert.equal(transactions, 1);
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].actorUserId, "user-1");
  assert.equal(auditEvents[0].resourceId, "session-foreign");
});

test("session revocation aborts when its audit event cannot be persisted", async () => {
  let persistedRevocation: Date | null = null;
  const controller = new AuthController({
    $transaction: async (callback: (transaction: Record<string, any>) => Promise<unknown>) => {
      let pendingRevocation: Date | null = null;
      const result = await callback({
        session: { updateMany: async ({ data }: { data: { revokedAt: Date } }) => { pendingRevocation = data.revokedAt; return { count: 1 }; } },
        auditEvent: { create: async () => { throw new Error("audit storage unavailable"); } },
      });
      persistedRevocation = pendingRevocation;
      return result;
    },
  } as never, {} as never);

  await assert.rejects(() => controller.revokeSession("session-1", {
    ...request,
    authSession: { id: "session-current", user: { id: "user-1", email: "admin@example.test", displayName: "Admin" } },
  }), /audit storage unavailable/);
  assert.equal(persistedRevocation, null);
});

test("revoke-other-sessions preserves the current session", async () => {
  let update: Record<string, any> | undefined;
  let transactions = 0;
  const auditEvents: Array<Record<string, any>> = [];
  const controller = new AuthController({
    $transaction: async (callback: (transaction: Record<string, any>) => Promise<unknown>) => {
      transactions += 1;
      return callback({
        session: { updateMany: async (args: Record<string, any>) => { update = args; return { count: 2 }; } },
        auditEvent: { create: async ({ data }: { data: Record<string, any> }) => { auditEvents.push(data); return {}; } },
      });
    },
  } as never, {} as never);
  const result = await controller.revokeOtherSessions({
    ...request,
    authSession: { id: "session-current", user: { id: "user-1", email: "admin@example.test", displayName: "Admin" } },
  });

  assert.deepEqual(update?.where, { userId: "user-1", id: { not: "session-current" }, revokedAt: null });
  assert.ok(update?.data.revokedAt instanceof Date);
  assert.equal(transactions, 1);
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].metadata.revokedCount, 2);
  assert.equal(result.revokedCount, 2);
});
