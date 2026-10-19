import assert from "node:assert/strict";
import test from "node:test";
import { calculatePKCECodeChallenge } from "openid-client";
import { randomBytes } from "node:crypto";
import { OAuthService } from "../src/auth/oauth.service.mjs";
import { hashRateLimitKey } from "../src/security/security.crypto.mjs";

function fixture(options: { account?: Record<string, unknown> | null; consumed?: number } = {}) {
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const codeChallenge = "pending-challenge";
  const now = new Date();
  const account = options.account === undefined ? {
    id: "user-hospital-a",
    email: "doctor@example.test",
    displayName: "Dr Example",
    status: "ACTIVE",
    emailVerifiedAt: now,
    mfaEnabled: false,
    memberships: [{
      id: "membership-a",
      role: "HOSPITAL_ADMIN",
      hospitalId: "hospital-a",
      branchId: null,
      department: null,
      organization: { id: "org-a", name: "Hospital A Group", slug: "hospital-a" },
      hospital: { id: "hospital-a", name: "Hospital A" },
      branch: null,
    }],
  } : options.account;
  const captured: { linked?: unknown; cookie?: string; sessionCount: number; events: unknown[] } = { sessionCount: 0, events: [] };
  const transaction = {
    oAuthLoginTransaction: { updateMany: async () => ({ count: options.consumed ?? 1 }) },
    externalIdentity: {
      findUnique: async () => null,
      create: async ({ data }: { data: unknown }) => { captured.linked = data; return data; },
    },
    user: { findUnique: async () => account },
    session: { create: async ({ data }: { data: { expiresAt: Date } }) => { captured.sessionCount += 1; return { id: "session-oauth", expiresAt: data.expiresAt }; } },
    auditEvent: { create: async ({ data }: { data: unknown }) => { captured.events.push(data); return data; } },
    authRateLimit: { deleteMany: async () => ({ count: 1 }) },
  };
  const prisma = {
    oAuthLoginTransaction: { findUnique: async () => ({
      id: "oauth-tx-1", provider: "google", mode: "HOSPITAL", nonceHash: hashRateLimitKey(`oauth-nonce:google:${nonce}`),
      codeChallenge: "", rememberMe: false, expiresAt: new Date(Date.now() + 60_000), usedAt: null,
    }) },
    authRateLimit: { findUnique: async () => null, upsert: async () => ({ failedAttempts: 1 }), update: async () => ({ failedAttempts: 1 }) },
    auditEvent: { create: async ({ data }: { data: unknown }) => { captured.events.push(data); return data; } },
    $transaction: async (callback: (tx: typeof transaction) => unknown) => callback(transaction),
  };
  const oidc = {
    verifyAuthorizationCode: async (_provider: string, input: { state: string; nonce: string; codeVerifier: string }) => {
      assert.equal(input.state, state);
      assert.equal(input.nonce, nonce);
      assert.equal(input.codeVerifier, verifier);
      return { subject: "provider-subject-1", email: "doctor@example.test" };
    },
  };
  const controller = new OAuthService(prisma as never, oidc as never);
  const response = { setHeader: (_name: string, value: string) => { captured.cookie = value; } };
  return { controller, state, nonce, verifier, codeChallenge, account, captured, response, prisma, transaction };
}

test("OAuth callback links a verified provider identity only to an existing verified hospital account", async () => {
  const f = fixture();
  const challenge = await calculatePKCECodeChallenge(f.verifier);
  (f.prisma.oAuthLoginTransaction.findUnique as unknown as (args: unknown) => Promise<unknown>) = async () => ({
    id: "oauth-tx-1", provider: "google", mode: "HOSPITAL", nonceHash: hashRateLimitKey(`oauth-nonce:google:${f.nonce}`),
    codeChallenge: challenge, rememberMe: false, expiresAt: new Date(Date.now() + 60_000), usedAt: null,
  });

  const result = await f.controller.callback("google", {
    code: "provider-one-time-code", state: f.state, nonce: f.nonce, codeVerifier: f.verifier,
  }, { ip: "192.0.2.1", headers: { "user-agent": "test browser" } }, f.response);

  assert.equal(result.mode, "HOSPITAL");
  assert.equal(result.user.email, "doctor@example.test");
  assert.equal(f.captured.sessionCount, 1);
  assert.deepEqual(f.captured.linked, { provider: "google", subject: "provider-subject-1", userId: "user-hospital-a" });
  assert.match(f.captured.cookie ?? "", /^jrxpert_session=[a-f0-9]{64}; HttpOnly; Path=\//);
  assert.equal((f.captured.events[0] as { action?: string }).action, "auth.oauth_login_succeeded");
});

test("OAuth callback rejects accounts without an allowed active membership and creates no identity or session", async () => {
  const f = fixture({ account: {
    id: "user-pending", email: "doctor@example.test", displayName: "Pending", status: "ACTIVE",
    emailVerifiedAt: new Date(), mfaEnabled: false, memberships: [],
  } });
  const challenge = await calculatePKCECodeChallenge(f.verifier);
  (f.prisma.oAuthLoginTransaction.findUnique as unknown as (args: unknown) => Promise<unknown>) = async () => ({
    id: "oauth-tx-1", provider: "google", mode: "HOSPITAL", nonceHash: hashRateLimitKey(`oauth-nonce:google:${f.nonce}`),
    codeChallenge: challenge, rememberMe: false, expiresAt: new Date(Date.now() + 60_000), usedAt: null,
  });

  await assert.rejects(() => f.controller.callback("google", {
    code: "provider-one-time-code", state: f.state, nonce: f.nonce, codeVerifier: f.verifier,
  }, { ip: "192.0.2.2", headers: {} }, f.response), /Sign-in could not be verified/);
  assert.equal(f.captured.sessionCount, 0);
  assert.equal(f.captured.linked, undefined);
  assert.equal(f.captured.cookie, undefined);
});

test("OAuth callback rejects a replayed or concurrently consumed state without issuing another session", async () => {
  const f = fixture({ consumed: 0 });
  const challenge = await calculatePKCECodeChallenge(f.verifier);
  (f.prisma.oAuthLoginTransaction.findUnique as unknown as (args: unknown) => Promise<unknown>) = async () => ({
    id: "oauth-tx-1", provider: "google", mode: "HOSPITAL", nonceHash: hashRateLimitKey(`oauth-nonce:google:${f.nonce}`),
    codeChallenge: challenge, rememberMe: false, expiresAt: new Date(Date.now() + 60_000), usedAt: null,
  });

  await assert.rejects(() => f.controller.callback("google", {
    code: "provider-one-time-code", state: f.state, nonce: f.nonce, codeVerifier: f.verifier,
  }, { ip: "192.0.2.3", headers: {} }, f.response), /Sign-in could not be verified/);
  assert.equal(f.captured.sessionCount, 0);
  assert.equal(f.captured.cookie, undefined);
});

test("OAuth callback rejects a forged PKCE verifier before contacting the identity provider", async () => {
  const f = fixture();
  const challenge = await calculatePKCECodeChallenge(f.verifier);
  (f.prisma.oAuthLoginTransaction.findUnique as unknown as (args: unknown) => Promise<unknown>) = async () => ({
    id: "oauth-tx-1", provider: "google", mode: "HOSPITAL", nonceHash: hashRateLimitKey(`oauth-nonce:google:${f.nonce}`),
    codeChallenge: challenge, rememberMe: false, expiresAt: new Date(Date.now() + 60_000), usedAt: null,
  });
  const forged = randomBytes(32).toString("base64url");

  await assert.rejects(() => f.controller.callback("google", {
    code: "provider-one-time-code", state: f.state, nonce: f.nonce, codeVerifier: forged,
  }, { ip: "192.0.2.4", headers: {} }, f.response), /Sign-in could not be verified/);
  assert.equal(f.captured.sessionCount, 0);
  assert.equal(f.captured.cookie, undefined);
});

test("OAuth callback cannot link an account whose local email has not been verified", async () => {
  const account = {
    id: "user-unverified", email: "doctor@example.test", displayName: "Doctor", status: "ACTIVE",
    emailVerifiedAt: null, mfaEnabled: false, memberships: [{
      id: "membership-a", role: "HOSPITAL_ADMIN", hospitalId: "hospital-a", branchId: null, department: null,
      organization: { id: "org-a", name: "Hospital A Group", slug: "hospital-a" },
      hospital: { id: "hospital-a", name: "Hospital A" }, branch: null,
    }],
  };
  const f = fixture({ account });
  const challenge = await calculatePKCECodeChallenge(f.verifier);
  (f.prisma.oAuthLoginTransaction.findUnique as unknown as (args: unknown) => Promise<unknown>) = async () => ({
    id: "oauth-tx-1", provider: "google", mode: "HOSPITAL", nonceHash: hashRateLimitKey(`oauth-nonce:google:${f.nonce}`),
    codeChallenge: challenge, rememberMe: false, expiresAt: new Date(Date.now() + 60_000), usedAt: null,
  });

  await assert.rejects(() => f.controller.callback("google", {
    code: "provider-one-time-code", state: f.state, nonce: f.nonce, codeVerifier: f.verifier,
  }, { ip: "192.0.2.5", headers: {} }, f.response), /Sign-in could not be verified/);
  assert.equal(f.captured.sessionCount, 0);
  assert.equal(f.captured.linked, undefined);
});
