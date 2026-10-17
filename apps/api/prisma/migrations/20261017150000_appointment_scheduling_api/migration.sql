-- Add explicit appointment capabilities. Patient directory access is not sufficient authorization for scheduling.
INSERT INTO "Permission" ("code", "description") VALUES
  ('appointment.read', 'Read bounded appointment metadata for an authorized hospital scope.'),
  ('appointment.schedule', 'Create a requested appointment in an authorized hospital scope.')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("role", "permissionId")
SELECT role_code::"MembershipRole", 'appointment.read'
FROM unnest(ARRAY[
  'ORGANIZATION_OWNER', 'HOSPITAL_ADMIN', 'HOSPITAL_MANAGER', 'MEDICAL_DIRECTOR',
  'DOCTOR', 'SPECIALIST_DOCTOR', 'NURSE', 'RECEPTIONIST'
]) AS role_code
ON CONFLICT ("role", "permissionId") DO NOTHING;

INSERT INTO "RolePermission" ("role", "permissionId")
SELECT role_code::"MembershipRole", 'appointment.schedule'
FROM unnest(ARRAY[
  'ORGANIZATION_OWNER', 'HOSPITAL_ADMIN', 'HOSPITAL_MANAGER', 'MEDICAL_DIRECTOR',
  'DOCTOR', 'SPECIALIST_DOCTOR', 'RECEPTIONIST'
]) AS role_code
ON CONFLICT ("role", "permissionId") DO NOTHING;

DROP POLICY "Appointment_hospital_scope_select" ON "Appointment";
CREATE POLICY "Appointment_hospital_scope_select" ON "Appointment" FOR SELECT USING (
  "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
  AND "hospitalId" = NULLIF(current_setting('app.hospital_id', true), '')
  AND (NULLIF(current_setting('app.branch_id', true), '') IS NULL OR "branchId" = NULLIF(current_setting('app.branch_id', true), ''))
  AND EXISTS (
    SELECT 1 FROM "Membership" m
    JOIN "Organization" o ON o."id" = m."organizationId" AND o."status" = 'ACTIVE'
    JOIN "Hospital" h ON h."id" = "Appointment"."hospitalId" AND h."organizationId" = m."organizationId" AND h."status" = 'ACTIVE'
    JOIN "RolePermission" rp ON rp."role" = m."role" AND rp."permissionId" = 'appointment.read'
    WHERE m."userId" = NULLIF(current_setting('app.user_id', true), '')
      AND m."organizationId" = "Appointment"."organizationId"
      AND (m."hospitalId" IS NULL OR m."hospitalId" = "Appointment"."hospitalId")
      AND (m."branchId" IS NULL OR m."branchId" = "Appointment"."branchId")
      AND m."status" = 'ACTIVE'
      AND (m."expiresAt" IS NULL OR m."expiresAt" > CURRENT_TIMESTAMP)
  )
);

CREATE POLICY "Appointment_hospital_scope_insert" ON "Appointment" FOR INSERT WITH CHECK (
  "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
  AND "hospitalId" = NULLIF(current_setting('app.hospital_id', true), '')
  AND "branchId" IS NOT DISTINCT FROM NULLIF(current_setting('app.branch_id', true), '')
  AND EXISTS (
    SELECT 1 FROM "Membership" m
    JOIN "Organization" o ON o."id" = m."organizationId" AND o."status" = 'ACTIVE'
    JOIN "Hospital" h ON h."id" = "Appointment"."hospitalId" AND h."organizationId" = m."organizationId" AND h."status" = 'ACTIVE'
    JOIN "RolePermission" rp ON rp."role" = m."role" AND rp."permissionId" = 'appointment.schedule'
    WHERE m."userId" = NULLIF(current_setting('app.user_id', true), '')
      AND m."organizationId" = "Appointment"."organizationId"
      AND (m."hospitalId" IS NULL OR m."hospitalId" = "Appointment"."hospitalId")
      AND (m."branchId" IS NULL OR m."branchId" IS NOT DISTINCT FROM "Appointment"."branchId")
      AND m."status" = 'ACTIVE'
      AND (m."expiresAt" IS NULL OR m."expiresAt" > CURRENT_TIMESTAMP)
  )
  AND EXISTS (
    SELECT 1 FROM "Patient" p
    WHERE p."id" = "Appointment"."patientId"
      AND p."organizationId" = "Appointment"."organizationId"
      AND p."hospitalId" = "Appointment"."hospitalId"
      AND p."branchId" IS NOT DISTINCT FROM "Appointment"."branchId"
  )
  AND EXISTS (
    SELECT 1 FROM "Membership" d
    JOIN "User" u ON u."id" = d."userId" AND u."status" = 'ACTIVE' AND u."emailVerifiedAt" IS NOT NULL
    WHERE d."id" = "Appointment"."doctorMembershipId"
      AND d."organizationId" = "Appointment"."organizationId"
      AND d."hospitalId" = "Appointment"."hospitalId"
      AND (d."branchId" IS NULL OR d."branchId" IS NOT DISTINCT FROM "Appointment"."branchId")
      AND d."role" IN ('DOCTOR', 'SPECIALIST_DOCTOR')
      AND d."status" = 'ACTIVE'
      AND (d."expiresAt" IS NULL OR d."expiresAt" > CURRENT_TIMESTAMP)
  )
);

-- Runtime may only create REQUESTED records; status, reason and other fields stay unavailable for direct writes.
GRANT INSERT ("id", "organizationId", "hospitalId", "branchId", "patientId", "doctorMembershipId", "startsAt", "durationMinutes", "createdAt", "updatedAt")
  ON TABLE "Appointment" TO jr_xpert_app;

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_durationMinutes_range_check" CHECK ("durationMinutes" BETWEEN 10 AND 240);

CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_doctor_schedule_no_overlap"
  EXCLUDE USING gist (
    "organizationId" WITH =,
    "doctorMembershipId" WITH =,
    tsrange("startsAt", "startsAt" + make_interval(mins => "durationMinutes")) WITH &&
  )
  WHERE ("status" IN ('REQUESTED', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'));
