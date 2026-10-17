CREATE TABLE "PlatformBootstrapToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "preparedAt" TIMESTAMP(3),
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformBootstrapToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlatformBootstrapToken_tokenHash_key" ON "PlatformBootstrapToken"("tokenHash");
CREATE INDEX "PlatformBootstrapToken_userId_expiresAt_usedAt_idx" ON "PlatformBootstrapToken"("userId", "expiresAt", "usedAt");
ALTER TABLE "PlatformBootstrapToken" ADD CONSTRAINT "PlatformBootstrapToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
GRANT SELECT, INSERT ON TABLE "PlatformBootstrapToken" TO jr_xpert_app;
GRANT UPDATE ("preparedAt", "usedAt") ON TABLE "PlatformBootstrapToken" TO jr_xpert_app;
