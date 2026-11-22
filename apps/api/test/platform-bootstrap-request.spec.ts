import assert from "node:assert/strict";
import { ServiceUnavailableException } from "@nestjs/common";
import { test } from "node:test";
import { PlatformBootstrapController } from "../src/applications/platform-bootstrap.controller.mjs";
import { hashSessionToken } from "../src/security/security.crypto.mjs";

const request = { headers: { origin: "https://hms.example.test" }, ip: "203.0.113.12" };
const configuredEmail = "masiradantroliya@gmail.com";

function setup({ activeAdmin = false, existingUser = null as Record<string, unknown> | null, deliveryFails = false } = {}) {
  const state = {
    organization: null as Record<string, unknown> | null,
    user: existingUser,
    memberships: [] as Array<Record<string, unknown>>,
    tokens: [] as Array<Record<string, unknown>>,
    audits: [] as Array<Record<string, unknown>>,
    emailCalls: [] as Array<{ email: string; token: string }>,
    activeAdmin,
  };
  const transaction = {
    $queryRaw: async () => [],
    membership: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        if (where.status === "ACTIVE" && state.activeAdmin) return { id: "active-platform-admin" };
        return state.memberships.find((membership) => Object.entries(where).every(([key, value]) => membership[key] === value)) ?? null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const membership = { id: "membership-1", ...data };
        state.memberships.push(membership);
        return { id: membership.id };
      },
    },
    organization: {
      findUnique: async () => state.organization,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.organization = { id: "organization-1", ...data };
        return { id: "organization-1", status: "ACTIVE" };
      },
    },
    user: {
      findUnique: async () => state.user ? { ...state.user, memberships: state.memberships } : null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.user = { id: "user-1", memberships: [], ...data };
        return { id: "user-1" };
      },
    },
    platformBootstrapToken: {
      findFirst: async ({ where }: { where: { userId: string; usedAt: null } }) => state.tokens.find((token) => token.userId === where.userId && token.usedAt === null && (token.expiresAt as Date) > new Date()) ?? null,
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        let count = 0;
        for (const token of state.tokens) {
          if (Object.entries(where).every(([key, value]) => token[key] === value)) { Object.assign(token, data); count += 1; }
        }
        return { count };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const token = { id: `bootstrap-${state.tokens.length + 1}`, preparedAt: null, usedAt: null, ...data };
        state.tokens.push(token);
        return { id: token.id };
      },
    },
    auditEvent: { createMany: async ({ data }: { data: Record<string, unknown> }) => { state.audits.push(data); return { count: 1 }; } },
  };
  const prisma = {
    $queryRaw: async () => [{ failedAttempts: 1 }],
    $transaction: async (callback: ((tx: typeof transaction) => Promise<unknown>) | Array<Promise<unknown>>) => Array.isArray(callback)
      ? Promise.all(callback)
      : callback(transaction),
    platformBootstrapToken: transaction.platformBootstrapToken,
    auditEvent: transaction.auditEvent,
  };
  const email = {
    isConfigured: () => true,
    sendPlatformBootstrap: async (recipient: string, token: string) => {
      state.emailCalls.push({ email: recipient, token });
      if (deliveryFails) throw new Error("provider failure");
    },
  };
  return { controller: new PlatformBootstrapController(prisma as never, email as never), state };
}

test("bootstrap request for an unconfigured email is non-enumerating and creates nothing", async () => {
  const previous = process.env.BOOTSTRAP_ADMIN_EMAIL;
  process.env.BOOTSTRAP_ADMIN_EMAIL = configuredEmail;
  try {
    const { controller, state } = setup();
    const result = await controller.request({ email: "someone-else@example.test" }, request);
    assert.match(result.message, /If this address is eligible/i);
    assert.equal(state.user, null);
    assert.equal(state.emailCalls.length, 0);
  } finally {
    if (previous === undefined) delete process.env.BOOTSTRAP_ADMIN_EMAIL;
    else process.env.BOOTSTRAP_ADMIN_EMAIL = previous;
  }
});

test("bootstrap request is disabled once an active platform administrator exists", async () => {
  const previous = process.env.BOOTSTRAP_ADMIN_EMAIL;
  process.env.BOOTSTRAP_ADMIN_EMAIL = configuredEmail;
  try {
    const { controller, state } = setup({ activeAdmin: true });
    const result = await controller.request({ email: configuredEmail }, request);
    assert.match(result.message, /If this address is eligible/i);
    assert.equal(state.user, null);
    assert.equal(state.emailCalls.length, 0);
  } finally {
    if (previous === undefined) delete process.env.BOOTSTRAP_ADMIN_EMAIL;
    else process.env.BOOTSTRAP_ADMIN_EMAIL = previous;
  }
});

test("first-admin setup sends a hash-backed one-time invite without setting a user password", async () => {
  const previous = process.env.BOOTSTRAP_ADMIN_EMAIL;
  process.env.BOOTSTRAP_ADMIN_EMAIL = configuredEmail;
  try {
    const { controller, state } = setup();
    const result = await controller.request({ email: ` ${configuredEmail.toUpperCase()} ` }, request);
    assert.match(result.message, /If this address is eligible/i);
    assert.equal(state.user?.email, configuredEmail);
    assert.equal(state.user?.status, "INVITED");
    assert.equal(state.user?.mfaEnabled, false);
    assert.equal(typeof state.user?.passwordHash, "string");
    assert.equal(state.memberships[0]?.role, "SUPER_ADMIN");
    assert.equal(state.memberships[0]?.status, "INVITED");
    assert.equal(state.tokens.length, 1);
    assert.equal(state.emailCalls.length, 1);
    assert.equal(state.emailCalls[0]?.email, configuredEmail);
    assert.equal(state.tokens[0]?.tokenHash, hashSessionToken(state.emailCalls[0]!.token));
    assert.equal(state.tokens[0]?.preparedAt, null);
  } finally {
    if (previous === undefined) delete process.env.BOOTSTRAP_ADMIN_EMAIL;
    else process.env.BOOTSTRAP_ADMIN_EMAIL = previous;
  }
});

test("duplicate bootstrap requests do not rotate a still-valid invitation link", async () => {
  const previous = process.env.BOOTSTRAP_ADMIN_EMAIL;
  process.env.BOOTSTRAP_ADMIN_EMAIL = configuredEmail;
  try {
    const { controller, state } = setup();
    await controller.request({ email: configuredEmail }, request);
    await controller.request({ email: configuredEmail }, request);
    assert.equal(state.tokens.length, 1);
    assert.equal(state.emailCalls.length, 1);
  } finally {
    if (previous === undefined) delete process.env.BOOTSTRAP_ADMIN_EMAIL;
    else process.env.BOOTSTRAP_ADMIN_EMAIL = previous;
  }
});

test("failed invitation delivery revokes the undisclosed one-time token", async () => {
  const previous = process.env.BOOTSTRAP_ADMIN_EMAIL;
  process.env.BOOTSTRAP_ADMIN_EMAIL = configuredEmail;
  try {
    const { controller, state } = setup({ deliveryFails: true });
    await assert.rejects(() => controller.request({ email: configuredEmail }, request), (error: unknown) => error instanceof ServiceUnavailableException);
    assert.equal(state.tokens.length, 1);
    assert.ok(state.tokens[0]?.usedAt instanceof Date);
    assert.ok(state.audits.some((audit) => audit.action === "platform.bootstrap_invitation_failed"));
  } finally {
    if (previous === undefined) delete process.env.BOOTSTRAP_ADMIN_EMAIL;
    else process.env.BOOTSTRAP_ADMIN_EMAIL = previous;
  }
});
