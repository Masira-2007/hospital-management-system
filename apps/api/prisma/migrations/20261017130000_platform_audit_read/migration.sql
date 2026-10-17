-- Allow the guarded platform audit endpoint to read audit summaries.
-- Metadata remains server-side and is deliberately excluded from the endpoint response.
GRANT SELECT ("id", "actorUserId", "organizationId", "action", "resourceType", "resourceId", "createdAt")
  ON TABLE "AuditEvent" TO jr_xpert_app;

CREATE INDEX IF NOT EXISTS "AuditEvent_createdAt_id_idx"
  ON "AuditEvent" ("createdAt" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "AuditEvent_action_createdAt_idx"
  ON "AuditEvent" ("action", "createdAt" DESC);
