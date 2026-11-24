import assert from "node:assert/strict";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { test } from "node:test";
import { PlatformBootstrapController } from "../src/applications/platform-bootstrap.controller.mjs";
import { createSessionToken, hashEmailVerificationCode, hashSessionToken, verifyPassword } from "../src/security/security.crypto.mjs";

const request = { headers: { origin: "https://hms.example.test" }, ip: "203.0.113.13" };

function setup() {
  const now = new Date();
  const token = {
    id: "bootstrap-token-1",
    userId: "admin-user-1",
    tokenHash: hashSessionToken("private-bootstrap-token"),
    expiresAt: new Date(now.getTime() + 30 * 60_000),
    preparedAt: null as Date | null,
    usedAt: null as Date | null,
  };
  const user = {
    id: token.userId,
    email: "admin@example.test",
    displayName: "Platform Administrator",
    passwordHash: "unconfigured",
    status: "INVITED",
    mfaEnabled: false,
    mfaSecretEncrypted: null as string | null,
    mfaLastUsedCounter: null as bigint | null,
  };
  const membership = {
    id: "platform-membership-1",
    userId: user.id,
    organizationId: "platform-organization-1",
    role: "SUPER_ADMIN",
    hospitalId: null,
    branchId: null,
    status: "INVITED",
    organization: { status: "ACTIVE" },
  };
  const state = {
    token,
    user,
    membership,
    challenges: [] as Array<Record<string, unknown>>,
    codesSent: [] as Array<{ email: string; code: string }>,
    audits: [] as Array<Record<string, unknown>>,
  };

  const matches = (record: Record<string, unknown>, where: Record<string, unknown>) => Object.entries(where).every(([key, expected]) => {
    const actual = record[key];
    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
      const constraint = expected as Record<string, unknown>;
      if ("gt" in constraint && !(actual instanceof Date && actual > (constraint.gt as Date))) return false;
      if ("lt" in constraint && !(typeof actual === "number" && actual < (constraint.lt as number))) return false;
      if ("not" in constraint && actual === constraint.not) return false;
      if ("increment" in constraint) return typeof actual === "number";
      return true;
    }
    return actual === expected;
  });

  const transaction = {
    platformBootstrapToken: {
      findUnique: async ({ where }: { where: Record<string, unknown> }) => matches(token, where) ? { ...token, user: { ...user } } : null,
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (!matches(token, where)) return { count: 0 };
        Object.assign(token, data);
        return { count: 1 };
      },
    },
    membership: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const flatWhere = { ...where };
        const organizationWhere = flatWhere.organization as { status?: string } | undefined;
        delete flatWhere.organization;
        return matches(membership, flatWhere) && (!organizationWhere || membership.organization.status === organizationWhere.status) ? { id: membership.id, organizationId: membership.organizationId } : null;
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (!matches(membership, where)) return { count: 0 };
        Object.assign(membership, data);
        return { count: 1 };
      },
    },
    user: {
      update: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        assert.equal(where.id, user.id);
        Object.assign(user, data);
        return user;
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (!matches(user, where)) return { count: 0 };
        Object.assign(user, data);
        return { count: 1 };
      },
    },
    loginVerificationCode: {
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        let count = 0;
        for (const challenge of state.challenges) {
          if (!matches(challenge, where)) continue;
          for (const [key, value] of Object.entries(data)) {
            if (value && typeof value === "object" && "increment" in value) challenge[key] = Number(challenge[key]) + Number((value as { increment: number }).increment);
            else challenge[key] = value;
          }
          count += 1;
        }
        return { count };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const challenge = { id: `challenge-${state.challenges.length + 1}`, failedAttempts: 0, usedAt: null, ...data };
        state.challenges.push(challenge);
        return { id: challenge.id };
      },
      findUnique: async ({ where }: { where: Record<string, unknown> }) => state.challenges.find((challenge) => matches(challenge, where)) ?? null,
    },
    auditEvent: { createMany: async ({ data }: { data: Record<string, unknown> }) => { state.audits.push(data); return { count: 1 }; } },
  };

  const prisma = {
    ...transaction,
    $queryRaw: async () => [{ failedAttempts: 1 }],
    $transaction: async (callback: ((tx: typeof transaction) => Promise<unknown>) | Array<Promise<unknown>>) => Array.isArray(callback)
      ? Promise.all(callback)
      : callback(transaction),
  };
  const email = {
    isEmailDeliveryConfigured: () => true,
    sendLoginVerificationCode: async (recipient: string, code: string) => { state.codesSent.push({ email: recipient, code }); },
  };

  return { controller: new PlatformBootstrapController(prisma as never, email as never), state };
}

test("first Super Admin remains inactive until the email code is verified; activation is single-use", async () => {
  const { controller, state } = setup();
  const password = "New-Unique-Admin-Password-47!";
  const prepared = await controller.prepare({ token: "private-bootstrap-token", displayName: "JR Xpert Administrator", password }, request);

  assert.equal(state.token.preparedAt instanceof Date, true);
  assert.equal(state.user.status, "INVITED");
  assert.equal(state.membership.status, "INVITED");
  assert.equal(await verifyPassword(password, state.user.passwordHash), true);
  assert.notEqual(state.user.passwordHash, password);
  assert.equal(state.challenges.length, 1);
  assert.equal(state.challenges[0]?.codeHash, hashEmailVerificationCode(state.codesSent[0]!.code));
  assert.equal("code" in state.challenges[0]!, false);
  assert.equal(state.codesSent[0]?.email, state.user.email);

  await assert.rejects(
    () => controller.complete({ token: "private-bootstrap-token", challengeToken: prepared.challengeToken, emailCode: "000000" }, request),
    (error: unknown) => error instanceof ForbiddenException,
  );
  assert.equal(state.user.status, "INVITED");
  assert.equal(state.membership.status, "INVITED");
  assert.equal(state.challenges[0]?.failedAttempts, 1);

  await controller.complete({ token: "private-bootstrap-token", challengeToken: prepared.challengeToken, emailCode: state.codesSent[0]!.code }, request);
  assert.equal(state.user.status, "ACTIVE");
  assert.equal(state.user.emailVerifiedAt instanceof Date, true);
  assert.equal(state.membership.status, "ACTIVE");
  assert.equal(state.token.usedAt instanceof Date, true);
  assert.equal(state.challenges[0]?.usedAt instanceof Date, true);
  assert.ok(state.audits.some((audit) => audit.action === "platform.bootstrap_completed"));

  await assert.rejects(
    () => controller.complete({ token: "private-bootstrap-token", challengeToken: prepared.challengeToken, emailCode: state.codesSent[0]!.code }, request),
    (error: unknown) => error instanceof BadRequestException,
  );
});
