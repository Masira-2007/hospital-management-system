import assert from "node:assert/strict";
import test from "node:test";
import { securePostgresConnectionString } from "../src/database/connection-string.mjs";

test("remote PostgreSQL TLS aliases are normalized to hostname-verified TLS", () => {
  const output = securePostgresConnectionString("postgresql://app:synthetic@ep-example.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require");
  const parsed = new URL(output);
  assert.equal(parsed.searchParams.get("sslmode"), "verify-full");
  assert.equal(parsed.searchParams.get("channel_binding"), "require");
});

test("remote PostgreSQL URLs without an SSL mode default to verified TLS", () => {
  const output = securePostgresConnectionString("postgresql://app:synthetic@db.example.test/appdb");
  assert.equal(new URL(output).searchParams.get("sslmode"), "verify-full");
});

test("remote PostgreSQL connections reject TLS disablement and unsupported modes", () => {
  assert.throws(
    () => securePostgresConnectionString("postgresql://app:synthetic@db.example.test/appdb?sslmode=disable"),
    /must use verified TLS/,
  );
  assert.throws(
    () => securePostgresConnectionString("postgresql://app:synthetic@db.example.test/appdb?sslmode=allow"),
    /sslmode=verify-full/,
  );
});

test("local development PostgreSQL URLs retain their configured SSL mode", () => {
  const local = "postgresql://app:synthetic@127.0.0.1:5432/appdb?sslmode=require";
  assert.equal(securePostgresConnectionString(local), local);
  const ipv6Local = "postgresql://app:synthetic@[::1]:5432/appdb?sslmode=require";
  assert.equal(securePostgresConnectionString(ipv6Local), ipv6Local);
});

test("connection URL must be a valid PostgreSQL URL", () => {
  assert.throws(() => securePostgresConnectionString("not-a-database-url"), /connection URL is invalid/);
  assert.throws(() => securePostgresConnectionString("https://db.example.test"), /must use PostgreSQL/);
});
