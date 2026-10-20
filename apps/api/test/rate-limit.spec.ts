import assert from "node:assert/strict";
import { HttpException } from "@nestjs/common";
import { test } from "node:test";
import { consumeFixedWindowLimit, pruneStaleRateLimitRecords } from "../src/security/rate-limit.mjs";

test("fixed-window limits increment atomically in PostgreSQL and reset only after the window expires", async () => {
  let sql = "";
  let parameters: unknown[] = [];
  await consumeFixedWindowLimit({
    $queryRaw: async (query: TemplateStringsArray, ...values: unknown[]) => {
      sql = query.join("?");
      parameters = values;
      return [{ failedAttempts: 1 }];
    },
  }, ["hashed-rate-limit-key"], 8, 15);

  assert.match(sql, /INSERT INTO "AuthRateLimit"/);
  assert.match(sql, /ON CONFLICT \("keyHash"\) DO UPDATE/);
  assert.match(sql, /"failedAttempts" \+ 1/);
  assert.match(sql, /"windowStartedAt" <= CURRENT_TIMESTAMP - \(\? \* INTERVAL '1 minute'\)/);
  assert.deepEqual(parameters, ["hashed-rate-limit-key", 15, 15]);
});

test("fixed-window limits reject attempts above the configured maximum with HTTP 429", async () => {
  await assert.rejects(
    consumeFixedWindowLimit({
      $queryRaw: async () => [{ failedAttempts: 9 }],
    }, ["hashed-rate-limit-key"], 8, 15),
    (error: unknown) => error instanceof HttpException && error.getStatus() === 429,
  );
});

test("stale rate-limit keys are pruned by indexed update time", async () => {
  let sql = "";
  let parameters: unknown[] = [];
  await pruneStaleRateLimitRecords({
    $queryRaw: async () => [],
    $executeRaw: async (query: TemplateStringsArray, ...values: unknown[]) => {
      sql = query.join("?");
      parameters = values;
      return 3;
    },
  });

  assert.match(sql, /DELETE FROM "AuthRateLimit"/);
  assert.match(sql, /"updatedAt" < CURRENT_TIMESTAMP/);
  assert.deepEqual(parameters, [24 * 60 * 60 * 1000]);
});
