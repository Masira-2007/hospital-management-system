import assert from "node:assert/strict";
import { createCipheriv, createHmac, randomBytes } from "node:crypto";
import { test } from "node:test";
import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { SameSiteCsrfGuard } from "../src/auth/same-site-csrf.guard";
import {
  createSessionToken,
  hashPassword,
  hashRateLimitKey,
  hashSessionToken,
  verifyPassword,
  verifyTotp,
} from "../src/security/security.crypto";

test("passwords are stored as salted scrypt hashes and are verified without plaintext storage", async () => {
  const first = await hashPassword("correct horse battery 927!");
  const second = await hashPassword("correct horse battery 927!");

  assert.match(first, /^scrypt\$32768\$8\$1\$/);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword("correct horse battery 927!", first), true);
  assert.equal(await verifyPassword("incorrect password", first), false);
  assert.equal(await verifyPassword("correct horse battery 927!", `${first}tampered`), false);
  await assert.rejects(() => hashPassword("short"));
});

test("session tokens are random opaque values and only their digest is stored", () => {
  const first = createSessionToken();
  const second = createSessionToken();

  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, second);
  assert.match(hashSessionToken(first), /^[a-f0-9]{64}$/);
  assert.notEqual(hashSessionToken(first), first);
});

test("rate-limit keys are keyed digests and MFA TOTP accepts only the encrypted configured secret", () => {
  const originalRateKey = process.env.AUTH_RATE_LIMIT_SECRET;
  const originalMfaKey = process.env.MFA_ENCRYPTION_KEY;
  process.env.AUTH_RATE_LIMIT_SECRET = "test-secret-that-is-long-enough-to-be-secure";
  process.env.MFA_ENCRYPTION_KEY = randomBytes(32).toString("hex");

  try {
    const rateHash = hashRateLimitKey("email:doctor@example.test");
    assert.match(rateHash, /^[a-f0-9]{64}$/);
    assert.equal(hashRateLimitKey("email:doctor@example.test"), rateHash);

    const now = 1_700_000_010_000;
    const secret = randomBytes(20);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", Buffer.from(process.env.MFA_ENCRYPTION_KEY, "hex"), iv);
    const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
    const encrypted = `${iv.toString("hex")}.${cipher.getAuthTag().toString("hex")}.${ciphertext.toString("hex")}`;
    const counter = BigInt(Math.floor(now / 30_000));
    const counterBytes = Buffer.alloc(8);
    counterBytes.writeBigUInt64BE(counter);
    const digest = createHmac("sha1", secret).update(counterBytes).digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const code = String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");

    assert.equal(verifyTotp(encrypted, code, now), counter);
    assert.equal(verifyTotp(encrypted, "000000", now), null);
    assert.equal(verifyTotp(`${encrypted}tampered`, code, now), null);
  } finally {
    if (originalRateKey === undefined) delete process.env.AUTH_RATE_LIMIT_SECRET;
    else process.env.AUTH_RATE_LIMIT_SECRET = originalRateKey;
    if (originalMfaKey === undefined) delete process.env.MFA_ENCRYPTION_KEY;
    else process.env.MFA_ENCRYPTION_KEY = originalMfaKey;
  }
});

test("CSRF guard requires an allowed Origin for the production __Host session cookie", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const guard = new SameSiteCsrfGuard(["https://hms.example"]);
  const request = {
    method: "POST",
    headers: { cookie: "other=value; __Host-jrxpert_session=opaque" },
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  try {
    assert.throws(() => guard.canActivate(context), ForbiddenException);
    request.headers = { ...request.headers, origin: "https://hms.example" };
    assert.equal(guard.canActivate(context), true);
    request.headers = { ...request.headers, origin: "https://attacker.example" };
    assert.throws(() => guard.canActivate(context), ForbiddenException);
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
});

test("CSRF guard recognizes the development session cookie and leaves safe methods alone", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  const guard = new SameSiteCsrfGuard(["http://localhost:3000"]);
  const request = { method: "POST", headers: { cookie: "jrxpert_session=opaque" } };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  try {
    assert.throws(() => guard.canActivate(context), ForbiddenException);
    request.method = "GET";
    assert.equal(guard.canActivate(context), true);
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
});
