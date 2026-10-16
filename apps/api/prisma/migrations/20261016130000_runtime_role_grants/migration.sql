-- Least-privilege runtime grants for the non-owner application login.
-- This role is intentionally not granted schema/table creation or migration ownership.
GRANT CONNECT ON DATABASE neondb TO jr_xpert_app;
GRANT USAGE ON SCHEMA public TO jr_xpert_app;

-- Authentication and tenant membership reads.
GRANT SELECT ON TABLE
  "User",
  "Organization",
  "Hospital",
  "Branch",
  "Membership",
  "RolePermission"
TO jr_xpert_app;

-- Patient directory is read-only at this stage; PostgreSQL RLS scopes each query.
GRANT SELECT ON TABLE "Patient", "Appointment" TO jr_xpert_app;

-- Authentication mutations only touch the named fields.
GRANT UPDATE ("passwordHash", "mfaLastUsedCounter", "updatedAt") ON TABLE "User" TO jr_xpert_app;
GRANT SELECT, INSERT ON TABLE "Session" TO jr_xpert_app;
GRANT UPDATE ("lastUsedAt", "revokedAt") ON TABLE "Session" TO jr_xpert_app;
GRANT SELECT, INSERT ON TABLE "PasswordResetToken" TO jr_xpert_app;
GRANT UPDATE ("usedAt") ON TABLE "PasswordResetToken" TO jr_xpert_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "AuthRateLimit" TO jr_xpert_app;

-- Audit entries are append-only, enforced by the migration trigger.
GRANT INSERT ON TABLE "AuditEvent" TO jr_xpert_app;
