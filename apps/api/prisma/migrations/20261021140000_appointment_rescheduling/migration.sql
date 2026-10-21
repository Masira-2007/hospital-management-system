-- Permit a narrowly scoped, audited rescheduling transition for future appointments.
INSERT INTO "Permission" ("code", "description") VALUES
  ('appointment.reschedule', 'Reschedule a future requested or confirmed appointment in an authorized hospital scope.')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("role", "permissionId")
SELECT role_code::"MembershipRole", 'appointment.reschedule'
FROM unnest(ARRAY[
  'ORGANIZATION_OWNER', 'HOSPITAL_ADMIN', 'HOSPITAL_MANAGER', 'MEDICAL_DIRECTOR',
  'DOCTOR', 'SPECIALIST_DOCTOR', 'NURSE', 'RECEPTIONIST'
]) AS role_code
ON CONFLICT ("role", "permissionId") DO NOTHING;

-- Column-level grants prevent changing tenant, patient, clinician, or appointment status.
GRANT UPDATE ("startsAt", "durationMinutes", "updatedAt") ON TABLE "Appointment" TO jr_xpert_app;

CREATE POLICY "Appointment_hospital_scope_reschedule" ON "Appointment" FOR UPDATE
USING (
  "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
  AND "hospitalId" = NULLIF(current_setting('app.hospital_id', true), '')
  AND (NULLIF(current_setting('app.branch_id', true), '') IS NULL OR "branchId" = NULLIF(current_setting('app.branch_id', true), ''))
  AND "status" IN ('REQUESTED', 'CONFIRMED')
  AND "startsAt" > clock_timestamp()
  AND EXISTS (
    SELECT 1 FROM "Membership" m
    JOIN "Organization" o ON o."id" = m."organizationId" AND o."status" = 'ACTIVE'
    JOIN "Hospital" h ON h."id" = "Appointment"."hospitalId" AND h."organizationId" = m."organizationId" AND h."status" = 'ACTIVE'
    JOIN "RolePermission" rp ON rp."role" = m."role" AND rp."permissionId" = 'appointment.reschedule'
    WHERE m."userId" = NULLIF(current_setting('app.user_id', true), '')
      AND m."organizationId" = "Appointment"."organizationId"
      AND (m."hospitalId" IS NULL OR m."hospitalId" = "Appointment"."hospitalId")
      AND (m."branchId" IS NULL OR m."branchId" = "Appointment"."branchId")
      AND m."status" = 'ACTIVE'
      AND (m."expiresAt" IS NULL OR m."expiresAt" > clock_timestamp())
  )
)
WITH CHECK (
  "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
  AND "hospitalId" = NULLIF(current_setting('app.hospital_id', true), '')
  AND (NULLIF(current_setting('app.branch_id', true), '') IS NULL OR "branchId" = NULLIF(current_setting('app.branch_id', true), ''))
  AND "status" IN ('REQUESTED', 'CONFIRMED')
  AND "startsAt" > clock_timestamp() + interval '10 minutes'
  AND "startsAt" <= clock_timestamp() + interval '365 days'
  AND "durationMinutes" BETWEEN 10 AND 240
  AND EXISTS (
    SELECT 1 FROM "Membership" m
    JOIN "Organization" o ON o."id" = m."organizationId" AND o."status" = 'ACTIVE'
    JOIN "Hospital" h ON h."id" = "Appointment"."hospitalId" AND h."organizationId" = m."organizationId" AND h."status" = 'ACTIVE'
    JOIN "RolePermission" rp ON rp."role" = m."role" AND rp."permissionId" = 'appointment.reschedule'
    WHERE m."userId" = NULLIF(current_setting('app.user_id', true), '')
      AND m."organizationId" = "Appointment"."organizationId"
      AND (m."hospitalId" IS NULL OR m."hospitalId" = "Appointment"."hospitalId")
      AND (m."branchId" IS NULL OR m."branchId" = "Appointment"."branchId")
      AND m."status" = 'ACTIVE'
      AND (m."expiresAt" IS NULL OR m."expiresAt" > clock_timestamp())
  )
);
