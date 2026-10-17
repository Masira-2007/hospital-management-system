import { HttpException, HttpStatus } from "@nestjs/common";

type RateLimitDatabase = {
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
};

export async function consumeFixedWindowLimit(database: RateLimitDatabase, keyHashes: string[], limit: number, windowMinutes: number): Promise<void> {
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
