-- Patient registration is a separate capability from directory read access.
INSERT INTO "Permission" ("code", "description") VALUES
  ('patient.record.create', 'Register a patient in an authorized hospital scope.')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("role", "permissionId")
SELECT role_code::"MembershipRole", 'patient.record.create'
FROM unnest(ARRAY[
  'ORGANIZATION_OWNER', 'HOSPITAL_ADMIN', 'HOSPITAL_MANAGER', 'RECEPTIONIST'
]) AS role_code
ON CONFLICT ("role", "permissionId") DO NOTHING;

CREATE POLICY "Patient_hospital_scope_insert" ON "Patient" FOR INSERT WITH CHECK (
  "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
  AND "hospitalId" = NULLIF(current_setting('app.hospital_id', true), '')
  AND "branchId" IS NOT DISTINCT FROM NULLIF(current_setting('app.branch_id', true), '')
  AND EXISTS (
    SELECT 1 FROM "Membership" m
    JOIN "User" u ON u."id" = m."userId" AND u."status" = 'ACTIVE' AND u."emailVerifiedAt" IS NOT NULL
    JOIN "Organization" o ON o."id" = m."organizationId" AND o."status" = 'ACTIVE'
    JOIN "Hospital" h ON h."id" = "Patient"."hospitalId" AND h."organizationId" = m."organizationId" AND h."status" = 'ACTIVE'
    JOIN "RolePermission" rp ON rp."role" = m."role" AND rp."permissionId" = 'patient.record.create'
    WHERE m."userId" = NULLIF(current_setting('app.user_id', true), '')
      AND m."organizationId" = "Patient"."organizationId"
      AND (m."hospitalId" IS NULL OR m."hospitalId" = "Patient"."hospitalId")
      AND (m."branchId" IS NULL OR m."branchId" IS NOT DISTINCT FROM "Patient"."branchId")
      AND m."status" = 'ACTIVE'
      AND (m."expiresAt" IS NULL OR m."expiresAt" > CURRENT_TIMESTAMP)
  )
);

-- The runtime role can create demographic registration records only. It cannot update, delete, or set extra columns.
GRANT INSERT ("id", "organizationId", "hospitalId", "branchId", "mrn", "firstName", "lastName", "dateOfBirth", "phone", "email", "createdAt", "updatedAt")
  ON TABLE "Patient" TO jr_xpert_app;
