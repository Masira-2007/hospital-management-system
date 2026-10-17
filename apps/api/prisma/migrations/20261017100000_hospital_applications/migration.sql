CREATE TYPE "HospitalApplicationStatus" AS ENUM (
  'EMAIL_PENDING',
  'PENDING_REVIEW',
  'NEEDS_INFORMATION',
  'APPROVED',
  'REJECTED'
);
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

INSERT INTO "Role" ("code", "name", "description", "platformScoped")
VALUES ('SUPER_ADMIN', 'Super administrator', 'Manages platform-level hospital onboarding and operations.', true);

CREATE TABLE "HospitalApplication" (
  "id" TEXT NOT NULL,
  "status" "HospitalApplicationStatus" NOT NULL DEFAULT 'EMAIL_PENDING',
  "hospitalName" TEXT NOT NULL,
  "hospitalType" TEXT NOT NULL,
  "officialEmail" TEXT NOT NULL,
  "contactPhone" TEXT NOT NULL,
  "website" TEXT,
  "streetAddress" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "country" TEXT NOT NULL,
  "postalCode" TEXT NOT NULL,
  "bedCount" INTEGER NOT NULL,
  "branchCount" INTEGER NOT NULL,
  "representativeName" TEXT NOT NULL,
  "representativeDesignation" TEXT NOT NULL,
  "proposedAdminName" TEXT NOT NULL,
  "proposedAdminEmail" TEXT NOT NULL,
  "requestedPlanCode" TEXT,
  "termsAcceptedAt" TIMESTAMP(3) NOT NULL,
  "verificationTokenHash" TEXT,
  "verificationExpiresAt" TIMESTAMP(3),
  "emailVerifiedAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "reviewedByUserId" TEXT,
  "reviewReason" TEXT,
  "createdHospitalId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HospitalApplication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HospitalApplication_verificationTokenHash_key"
  ON "HospitalApplication"("verificationTokenHash");
CREATE UNIQUE INDEX "HospitalApplication_createdHospitalId_key"
  ON "HospitalApplication"("createdHospitalId");
CREATE INDEX "HospitalApplication_status_createdAt_idx"
  ON "HospitalApplication"("status", "createdAt");
CREATE INDEX "HospitalApplication_officialEmail_status_idx"
  ON "HospitalApplication"("officialEmail", "status");
CREATE INDEX "HospitalApplication_proposedAdminEmail_status_idx"
  ON "HospitalApplication"("proposedAdminEmail", "status");
ALTER TABLE "HospitalApplication" ADD CONSTRAINT "HospitalApplication_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HospitalApplication" ADD CONSTRAINT "HospitalApplication_createdHospitalId_fkey"
  FOREIGN KEY ("createdHospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "HospitalInvitation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "hospitalId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "preparedUserId" TEXT,
  "intendedEmail" TEXT NOT NULL,
  "intendedName" TEXT NOT NULL,
  "role" "MembershipRole" NOT NULL DEFAULT 'HOSPITAL_ADMIN',
  "tokenHash" TEXT NOT NULL,
  "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
  "deliveryStatus" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "preparedAt" TIMESTAMP(3),
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HospitalInvitation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HospitalInvitation_tokenHash_key" ON "HospitalInvitation"("tokenHash");
CREATE INDEX "HospitalInvitation_hospitalId_status_expiresAt_idx"
  ON "HospitalInvitation"("hospitalId", "status", "expiresAt");
CREATE INDEX "HospitalInvitation_intendedEmail_status_idx"
  ON "HospitalInvitation"("intendedEmail", "status");
ALTER TABLE "HospitalInvitation" ADD CONSTRAINT "HospitalInvitation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HospitalInvitation" ADD CONSTRAINT "HospitalInvitation_hospitalId_organizationId_fkey"
  FOREIGN KEY ("hospitalId", "organizationId") REFERENCES "Hospital"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HospitalInvitation" ADD CONSTRAINT "HospitalInvitation_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HospitalInvitation" ADD CONSTRAINT "HospitalInvitation_preparedUserId_fkey"
  FOREIGN KEY ("preparedUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Runtime app access stays scoped to onboarding/account provisioning fields.
-- The app role does not own these objects and cannot change schema or role grants.
GRANT SELECT, INSERT, UPDATE ON TABLE "HospitalApplication" TO jr_xpert_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "HospitalInvitation" TO jr_xpert_app;
GRANT INSERT ON TABLE "Organization", "Hospital", "Branch", "HospitalSettings" TO jr_xpert_app;
GRANT SELECT ON TABLE "Organization", "Hospital", "Branch" TO jr_xpert_app;
GRANT UPDATE ("status") ON TABLE "Organization", "Hospital", "Branch" TO jr_xpert_app;
GRANT INSERT ON TABLE "User" TO jr_xpert_app;
GRANT UPDATE ("displayName", "passwordHash", "status", "emailVerifiedAt", "mfaEnabled", "mfaSecretEncrypted", "mfaLastUsedCounter", "updatedAt") ON TABLE "User" TO jr_xpert_app;
GRANT SELECT, INSERT ON TABLE "Membership" TO jr_xpert_app;
GRANT UPDATE ("status", "expiresAt") ON TABLE "Membership" TO jr_xpert_app;
