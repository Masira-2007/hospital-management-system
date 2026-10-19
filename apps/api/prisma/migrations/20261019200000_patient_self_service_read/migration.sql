-- Patient self-service is read-only and requires an explicit, active access grant.
-- The runtime role sees only its own view-enabled grants; patient-row RLS then
-- independently enforces the selected organization, hospital and branch.
GRANT SELECT ON TABLE "PatientAccessGrant" TO jr_xpert_app;

ALTER TABLE "PatientAccessGrant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PatientAccessGrant" FORCE ROW LEVEL SECURITY;
CREATE POLICY "PatientAccessGrant_own_active_select" ON "PatientAccessGrant" FOR SELECT USING (
  "userId" = NULLIF(current_setting('app.user_id', true), '')
  AND "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
  AND "canViewRecords" = true
  AND "revokedAt" IS NULL
  AND ("expiresAt" IS NULL OR "expiresAt" > CURRENT_TIMESTAMP)
);

CREATE POLICY "Patient_explicit_grant_select" ON "Patient" FOR SELECT USING (
  "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
  AND "hospitalId" = NULLIF(current_setting('app.hospital_id', true), '')
  AND (NULLIF(current_setting('app.branch_id', true), '') IS NULL OR "branchId" = NULLIF(current_setting('app.branch_id', true), ''))
  AND EXISTS (
    SELECT 1
    FROM "PatientAccessGrant" g
    WHERE g."patientId" = "Patient"."id"
      AND g."organizationId" = "Patient"."organizationId"
      AND g."userId" = NULLIF(current_setting('app.user_id', true), '')
      AND g."canViewRecords" = true
      AND g."revokedAt" IS NULL
      AND (g."expiresAt" IS NULL OR g."expiresAt" > CURRENT_TIMESTAMP)
  )
);
