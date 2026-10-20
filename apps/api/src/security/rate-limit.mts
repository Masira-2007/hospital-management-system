import { HttpException, HttpStatus } from "@nestjs/common";

type RateLimitDatabase = {
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $executeRaw?(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
};

const PRUNE_EVERY_LIMIT_CHECKS = 100;
const RATE_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000;
let checksSincePrune = 0;

export async function consumeFixedWindowLimit(database: RateLimitDatabase, keyHashes: string[], limit: number, windowMinutes: number): Promise<void> {
  checksSincePrune += 1;
  if (checksSincePrune >= PRUNE_EVERY_LIMIT_CHECKS) {
    checksSincePrune = 0;
    // Opportunistic cleanup is shared by login, recovery, onboarding and bootstrap
    // limiters. A cleanup failure must not disable the actual rate limit below.
    if (database.$executeRaw) {
      try {
        await pruneStaleRateLimitRecords(database);
      } catch {
        // Pruning is maintenance only; the upsert below remains fail-closed.
      }
    }
  }

  for (const keyHash of keyHashes) {
    const rows = await database.$queryRaw<Array<{ failedAttempts: number }>>`
      INSERT INTO "AuthRateLimit" ("keyHash", "failedAttempts", "windowStartedAt", "updatedAt")
      VALUES (${keyHash}, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("keyHash") DO UPDATE SET
        "failedAttempts" = CASE
          WHEN "AuthRateLimit"."windowStartedAt" <= CURRENT_TIMESTAMP - (${windowMinutes} * INTERVAL '1 minute') THEN 1
          ELSE "AuthRateLimit"."failedAttempts" + 1
        END,
        "windowStartedAt" = CASE
          WHEN "AuthRateLimit"."windowStartedAt" <= CURRENT_TIMESTAMP - (${windowMinutes} * INTERVAL '1 minute') THEN CURRENT_TIMESTAMP
          ELSE "AuthRateLimit"."windowStartedAt"
        END,
        "updatedAt" = CURRENT_TIMESTAMP
      RETURNING "failedAttempts"
    `;
    if ((rows[0]?.failedAttempts ?? limit + 1) > limit) {
      throw new HttpException("Too many requests. Try again later.", HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}

export async function pruneStaleRateLimitRecords(database: RateLimitDatabase): Promise<void> {
  if (!database.$executeRaw) return;
  await database.$executeRaw`
    DELETE FROM "AuthRateLimit"
    WHERE "updatedAt" < CURRENT_TIMESTAMP - (${RATE_LIMIT_RETENTION_MS} * INTERVAL '1 millisecond')
  `;
}
