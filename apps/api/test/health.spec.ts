import assert from "node:assert/strict";
import { test } from "node:test";
import { HealthController } from "../src/health.controller.mjs";

test("health response reports API liveness without exposing configuration", () => {
  const response = new HealthController({} as never).getHealth();

  assert.equal(response.status, "ok");
  assert.equal(response.service, "jr-xpert-hms-api");
  assert.equal(response.version, "0.1.0");
  assert.ok(Number.isFinite(Date.parse(response.timestamp)));
  assert.equal("databaseUrl" in response, false);
  assert.equal("secret" in response, false);
});

test("readiness confirms database connectivity without returning internal details", async () => {
  const controller = new HealthController({ $queryRaw: async () => [{ "?column?": 1 }] } as never);
  const response = await controller.getReadiness();
  assert.equal(response.status, "ready");
  assert.equal("databaseUrl" in response, false);
});

test("readiness returns a generic unavailable response when the database cannot be reached", async () => {
  const controller = new HealthController({ $queryRaw: async () => { throw new Error("secret connection string"); } } as never);
  await assert.rejects(() => controller.getReadiness(), (error: unknown) => {
    assert.equal((error as { getStatus?: () => number }).getStatus?.(), 503);
    assert.equal(JSON.stringify((error as { getResponse?: () => unknown }).getResponse?.()).includes("secret connection string"), false);
    return true;
  });
});
