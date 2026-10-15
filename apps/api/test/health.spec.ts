import assert from "node:assert/strict";
import { test } from "node:test";
import { HealthController } from "../src/health.controller";

test("health response reports API liveness without exposing configuration", () => {
  const response = new HealthController().getHealth();

  assert.equal(response.status, "ok");
  assert.equal(response.service, "jr-xpert-hms-api");
  assert.equal(response.version, "0.1.0");
  assert.ok(Number.isFinite(Date.parse(response.timestamp)));
  assert.equal("databaseUrl" in response, false);
  assert.equal("secret" in response, false);
});
