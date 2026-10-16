-- JR Xpert HMS incremental identity, tenant-status and defense-in-depth migration.
CREATE TYPE "TenantStatus" AS ENUM ('PROVISIONING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');

ALTER TABLE "Organization" ADD COLUMN "status" "TenantStatus" NOT NULL DEFAULT 'PROVISIONING';
ALTER TABLE "Hospital" ADD COLUMN "status" "TenantStatus" NOT NULL DEFAULT 'PROVISIONING';
ALTER TABLE "Branch" ADD COLUMN "status" "TenantStatus" NOT NULL DEFAULT 'PROVISIONING';

CREATE TABLE "PasswordResetToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_expiresAt_idx" ON "PasswordResetToken"("userId", "expiresAt");
CREATE INDEX "PasswordResetToken_expiresAt_usedAt_idx" ON "PasswordResetToken"("expiresAt", "usedAt");
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Role" (
  "code" "MembershipRole" NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "platformScoped" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "Role_pkey" PRIMARY KEY ("code")
);
CREATE TABLE "Permission" (
  "code" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  CONSTRAINT "Permission_pkey" PRIMARY KEY ("code")
);
CREATE TABLE "RolePermission" (
  "role" "MembershipRole" NOT NULL,
  "permissionId" TEXT NOT NULL,
  CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("role", "permissionId")
);
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_role_fkey"
  FOREIGN KEY ("role") REFERENCES "Role"("code") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey"
  FOREIGN KEY ("permissionId") REFERENCES "Permission"("code") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_role_fkey"
  FOREIGN KEY ("role") REFERENCES "Role"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "Role" ("code", "name", "platformScoped") VALUES
  ('PLATFORM_ADMIN', 'Platform administrator', true),
  ('ORGANIZATION_OWNER', 'Organization owner', false),
  ('HOSPITAL_ADMIN', 'Hospital administrator', false),
  ('HOSPITAL_MANAGER', 'Hospital manager', false),
  ('MEDICAL_DIRECTOR', 'Medical director', false),
  ('DOCTOR', 'Doctor', false),
  ('SPECIALIST_DOCTOR', 'Specialist doctor', false),
  ('NURSE', 'Nurse', false),
  ('RECEPTIONIST', 'Receptionist', false),
  ('PATIENT', 'Patient', false),
  ('PHARMACIST', 'Pharmacist', false),
  ('PHARMACY_MANAGER', 'Pharmacy manager', false),
  ('LAB_TECHNICIAN', 'Laboratory technician', false),
  ('LAB_MANAGER', 'Laboratory manager', false),
  ('RADIOLOGIST', 'Radiologist', false),
  ('BILLING_EXECUTIVE', 'Billing executive', false),
  ('ACCOUNTANT', 'Accountant', false),
  ('CLAIMS_EXECUTIVE', 'Claims executive', false),
  ('HR_MANAGER', 'HR manager', false),
  ('HOSPITAL_STAFF', 'Hospital staff', false),
  ('WARD_MANAGER', 'Ward manager', false),
  ('OT_MANAGER', 'Operating theatre manager', false),
  ('INVENTORY_MANAGER', 'Inventory manager', false),
  ('AMBULANCE_OPERATOR', 'Ambulance operator', false),
  ('SECURITY_AUDITOR', 'Security auditor', false),
  ('REFERRING_DOCTOR', 'Referring doctor', false);
INSERT INTO "Permission" ("code", "description") VALUES
  ('patient.directory.read', 'Read the limited patient directory for an authorized hospital scope.');
INSERT INTO "RolePermission" ("role", "permissionId") VALUES
  ('ORGANIZATION_OWNER', 'patient.directory.read'),
  ('HOSPITAL_ADMIN', 'patient.directory.read'),
  ('HOSPITAL_MANAGER', 'patient.directory.read'),
  ('MEDICAL_DIRECTOR', 'patient.directory.read'),
  ('DOCTOR', 'patient.directory.read'),
  ('SPECIALIST_DOCTOR', 'patient.directory.read'),
  ('NURSE', 'patient.directory.read'),
  ('RECEPTIONIST', 'patient.directory.read');

CREATE TABLE "HospitalSettings" (
  "id" TEXT NOT NULL,
  "hospitalId" TEXT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "locale" TEXT NOT NULL DEFAULT 'en-IN',
  "invoiceSettings" JSONB,
  "taxSettings" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HospitalSettings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HospitalSettings_hospitalId_key" ON "HospitalSettings"("hospitalId");
ALTER TABLE "HospitalSettings" ADD CONSTRAINT "HospitalSettings_hospitalId_fkey"
  FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "SubscriptionPlan" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "entitlements" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SubscriptionPlan_code_key" ON "SubscriptionPlan"("code");

CREATE TABLE "HospitalSubscription" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "hospitalId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
  "trialEndsAt" TIMESTAMP(3),
  "currentPeriodStart" TIMESTAMP(3) NOT NULL,
  "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
  "canceledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HospitalSubscription_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HospitalSubscription_organizationId_hospitalId_status_idx"
  ON "HospitalSubscription"("organizationId", "hospitalId", "status");
CREATE INDEX "HospitalSubscription_status_currentPeriodEnd_idx"
  ON "HospitalSubscription"("status", "currentPeriodEnd");
ALTER TABLE "HospitalSubscription" ADD CONSTRAINT "HospitalSubscription_hospitalId_organizationId_fkey"
  FOREIGN KEY ("hospitalId", "organizationId") REFERENCES "Hospital"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HospitalSubscription" ADD CONSTRAINT "HospitalSubscription_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PatientAccessGrant" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "relationship" TEXT NOT NULL DEFAULT 'SELF',
  "canViewRecords" BOOLEAN NOT NULL DEFAULT false,
  "canManageCare" BOOLEAN NOT NULL DEFAULT false,
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PatientAccessGrant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PatientAccessGrant_userId_patientId_key" ON "PatientAccessGrant"("userId", "patientId");
CREATE INDEX "PatientAccessGrant_userId_organizationId_revokedAt_idx" ON "PatientAccessGrant"("userId", "organizationId", "revokedAt");
CREATE INDEX "PatientAccessGrant_patientId_organizationId_revokedAt_idx" ON "PatientAccessGrant"("patientId", "organizationId", "revokedAt");
ALTER TABLE "PatientAccessGrant" ADD CONSTRAINT "PatientAccessGrant_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientAccessGrant" ADD CONSTRAINT "PatientAccessGrant_patientId_organizationId_fkey"
  FOREIGN KEY ("patientId", "organizationId") REFERENCES "Patient"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Force RLS for table owners too; production runtime must use a non-superuser, non-BYPASSRLS database role.
ALTER TABLE "Patient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Patient" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Patient_hospital_scope_select" ON "Patient" FOR SELECT USING (
  "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
  AND "hospitalId" = NULLIF(current_setting('app.hospital_id', true), '')
  AND (NULLIF(current_setting('app.branch_id', true), '') IS NULL OR "branchId" = NULLIF(current_setting('app.branch_id', true), ''))
  AND EXISTS (
    SELECT 1 FROM "Membership" m
    JOIN "Organization" o ON o."id" = m."organizationId" AND o."status" = 'ACTIVE'
    JOIN "Hospital" h ON h."id" = "Patient"."hospitalId" AND h."organizationId" = m."organizationId" AND h."status" = 'ACTIVE'
    JOIN "RolePermission" rp ON rp."role" = m."role" AND rp."permissionId" = 'patient.directory.read'
    WHERE m."userId" = NULLIF(current_setting('app.user_id', true), '')
      AND m."organizationId" = "Patient"."organizationId"
      AND (m."hospitalId" IS NULL OR m."hospitalId" = "Patient"."hospitalId")
      AND (m."branchId" IS NULL OR m."branchId" = "Patient"."branchId")
      AND m."status" = 'ACTIVE'
      AND (m."expiresAt" IS NULL OR m."expiresAt" > CURRENT_TIMESTAMP)
  )
);

ALTER TABLE "Appointment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Appointment" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Appointment_hospital_scope_select" ON "Appointment" FOR SELECT USING (
  "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
  AND "hospitalId" = NULLIF(current_setting('app.hospital_id', true), '')
  AND (NULLIF(current_setting('app.branch_id', true), '') IS NULL OR "branchId" = NULLIF(current_setting('app.branch_id', true), ''))
  AND EXISTS (
    SELECT 1 FROM "Membership" m
    JOIN "Organization" o ON o."id" = m."organizationId" AND o."status" = 'ACTIVE'
    JOIN "Hospital" h ON h."id" = "Appointment"."hospitalId" AND h."organizationId" = m."organizationId" AND h."status" = 'ACTIVE'
    JOIN "RolePermission" rp ON rp."role" = m."role" AND rp."permissionId" = 'patient.directory.read'
    WHERE m."userId" = NULLIF(current_setting('app.user_id', true), '')
      AND m."organizationId" = "Appointment"."organizationId"
      AND (m."hospitalId" IS NULL OR m."hospitalId" = "Appointment"."hospitalId")
      AND (m."branchId" IS NULL OR m."branchId" = "Appointment"."branchId")
      AND m."status" = 'ACTIVE'
      AND (m."expiresAt" IS NULL OR m."expiresAt" > CURRENT_TIMESTAMP)
  )
);

CREATE FUNCTION "prevent_audit_event_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit events are append-only';
END;
$$;
CREATE TRIGGER "AuditEvent_no_update_or_delete"
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION "prevent_audit_event_mutation"();
CREATE TRIGGER "AuditEvent_no_truncate"
  BEFORE TRUNCATE ON "AuditEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION "prevent_audit_event_mutation"();
