-- Store only keyed hashes for short-lived email sign-in codes.
CREATE TABLE "LoginVerificationCode" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "rememberMe" BOOLEAN NOT NULL DEFAULT false,
  "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoginVerificationCode_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LoginVerificationCode_mode_check" CHECK ("mode" IN ('HOSPITAL', 'PATIENT', 'SUPER_ADMIN')),
  CONSTRAINT "LoginVerificationCode_failedAttempts_check" CHECK ("failedAttempts" BETWEEN 0 AND 5),
  CONSTRAINT "LoginVerificationCode_tokenHash_check" CHECK ("tokenHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "LoginVerificationCode_codeHash_check" CHECK ("codeHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "LoginVerificationCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "LoginVerificationCode_tokenHash_key" ON "LoginVerificationCode"("tokenHash");
CREATE INDEX "LoginVerificationCode_userId_createdAt_idx" ON "LoginVerificationCode"("userId", "createdAt");
CREATE INDEX "LoginVerificationCode_expiresAt_usedAt_idx" ON "LoginVerificationCode"("expiresAt", "usedAt");

-- This short-lived challenge table contains only keyed code hashes and the app runtime
-- needs no more than challenge issuance, lookup, bounded attempts, and one-time consume.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "LoginVerificationCode" TO jr_xpert_app;
