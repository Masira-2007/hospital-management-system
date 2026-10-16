import {
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (password: string | Buffer, salt: Buffer, keyLength: number, options: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const MAXMEM = 64 * 1024 * 1024;
const DUMMY_HASH = `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${"00".repeat(16)}$${"00".repeat(SCRYPT_KEY_LENGTH)}`;

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || Buffer.byteLength(password, "utf8") > 128) {
    throw new Error("Passwords must be 12–128 UTF-8 bytes.");
  }
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: MAXMEM,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  if (Buffer.byteLength(password, "utf8") > 128) return false;
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltHex, keyHex] = parts;
  if (n !== String(SCRYPT_N) || r !== String(SCRYPT_R) || p !== String(SCRYPT_P)) return false;
  if (!/^[a-f0-9]{32}$/i.test(saltHex) || !/^[a-f0-9]{128}$/i.test(keyHex)) return false;

  const expected = Buffer.from(keyHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: MAXMEM,
  });
  return timingSafeEqual(actual, expected);
}

export async function performDummyPasswordCheck(password: string): Promise<void> {
  await verifyPassword(password, DUMMY_HASH);
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashRateLimitKey(value: string): string {
  const secret = process.env.AUTH_RATE_LIMIT_SECRET ?? "development-only-rate-limit-key-not-for-production";
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function verifyTotp(encryptedSecret: string, code: string, now = Date.now()): bigint | null {
  const keyHex = process.env.MFA_ENCRYPTION_KEY;
  if (!keyHex || !/^[a-f0-9]{64}$/i.test(keyHex)) return null;
  const [ivHex, tagHex, ciphertextHex] = encryptedSecret.split(".");
  if (!/^[a-f0-9]{24}$/i.test(ivHex) || !/^[a-f0-9]{32}$/i.test(tagHex) || !/^[a-f0-9]+$/i.test(ciphertextHex ?? "")) return null;

  try {
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const secret = Buffer.concat([
      decipher.update(Buffer.from(ciphertextHex, "hex")),
      decipher.final(),
    ]);
    const currentCounter = BigInt(Math.floor(now / 30_000));
    for (const counter of [currentCounter - 1n, currentCounter, currentCounter + 1n]) {
      if (counter < 0n) continue;
      const counterBytes = Buffer.alloc(8);
      counterBytes.writeBigUInt64BE(counter);
      const digest = createHmac("sha1", secret).update(counterBytes).digest();
      const offset = digest[digest.length - 1] & 0x0f;
      const binary = digest.readUInt32BE(offset) & 0x7fffffff;
      const expected = String(binary % 1_000_000).padStart(6, "0");
      const providedBytes = Buffer.from(code);
      const expectedBytes = Buffer.from(expected);
      if (providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes)) return counter;
    }
  } catch {
    return null;
  }
  return null;
}
