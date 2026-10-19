-- OAuth state is short-lived and single-use; provider identity links point only
-- to existing, verified application users. No OAuth account auto-provisioning.
CREATE TABLE "OAuthLoginTransaction" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "stateHash" TEXT NOT NULL,
  "nonceHash" TEXT NOT NULL,
  "codeChallenge" TEXT NOT NULL,
  "rememberMe" BOOLEAN NOT NULL DEFAULT false,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OAuthLoginTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OAuthLoginTransaction_provider_check" CHECK ("provider" IN ('google', 'apple')),
  CONSTRAINT "OAuthLoginTransaction_mode_check" CHECK ("mode" IN ('HOSPITAL', 'PATIENT', 'SUPER_ADMIN')),
  CONSTRAINT "OAuthLoginTransaction_stateHash_check" CHECK ("stateHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "OAuthLoginTransaction_nonceHash_check" CHECK ("nonceHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "OAuthLoginTransaction_codeChallenge_check" CHECK ("codeChallenge" ~ '^[A-Za-z0-9_-]{43}$')
);

CREATE UNIQUE INDEX "OAuthLoginTransaction_stateHash_key" ON "OAuthLoginTransaction"("stateHash");
CREATE INDEX "OAuthLoginTransaction_expiresAt_usedAt_idx" ON "OAuthLoginTransaction"("expiresAt", "usedAt");

CREATE TABLE "ExternalIdentity" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExternalIdentity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExternalIdentity_provider_check" CHECK ("provider" IN ('google', 'apple')),
  CONSTRAINT "ExternalIdentity_subject_check" CHECK (length("subject") BETWEEN 1 AND 255),
  CONSTRAINT "ExternalIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ExternalIdentity_provider_subject_key" ON "ExternalIdentity"("provider", "subject");
CREATE UNIQUE INDEX "ExternalIdentity_userId_provider_key" ON "ExternalIdentity"("userId", "provider");
CREATE INDEX "ExternalIdentity_userId_idx" ON "ExternalIdentity"("userId");

-- Runtime may create/read identity links and consume OAuth state exactly once.
-- It cannot change linked subjects or use these tables to provision users.
GRANT SELECT, INSERT ON TABLE "ExternalIdentity" TO jr_xpert_app;
GRANT SELECT, INSERT, DELETE ON TABLE "OAuthLoginTransaction" TO jr_xpert_app;
GRANT UPDATE ("usedAt") ON TABLE "OAuthLoginTransaction" TO jr_xpert_app;
