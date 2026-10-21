import dotenv from "dotenv";
import { resolve } from "node:path";
import pg from "pg";
import { securePostgresConnectionString } from "../database/connection-string.mjs";

dotenv.config({ path: resolve(process.cwd(), "../../.env"), quiet: true });

const directUrl = process.env.DIRECT_URL;
if (!directUrl) throw new Error("DIRECT_URL is required for the read-only runtime-role verification.");

const pool = new pg.Pool({ connectionString: securePostgresConnectionString(directUrl), max: 1, connectionTimeoutMillis: 10_000 });
try {
  const { rows } = await pool.query<{
    membershipMigrationApplied: boolean;
    patientSelfServiceMigrationApplied: boolean;
    appointmentCancellationMigrationApplied: boolean;
    auditEventGrantMigrationApplied: boolean;
    appointmentReschedulingMigrationApplied: boolean;
    sessionScopeUpdate: boolean;
    appRoleExists: boolean;
    appRoleSuperuser: boolean | null;
    appRoleBypassRls: boolean | null;
    patientRlsEnabled: boolean;
    patientRlsForced: boolean;
    accessGrantRlsEnabled: boolean | null;
    accessGrantRlsForced: boolean | null;
    accessGrantSelect: boolean;
    auditEventInsert: boolean;
    appointmentStatusUpdate: boolean;
    appointmentStartsAtUpdate: boolean;
    appointmentDurationUpdate: boolean;
    appointmentCancelPolicy: boolean;
    appointmentReschedulePolicy: boolean;
    patientGrantPolicy: boolean;
    ownActiveGrantPolicy: boolean;
  }>(`
    SELECT
      EXISTS (
        SELECT 1 FROM "_prisma_migrations"
        WHERE migration_name = '20261019160000_session_membership_selection'
          AND finished_at IS NOT NULL
          AND rolled_back_at IS NULL
      ) AS "membershipMigrationApplied",
      EXISTS (
        SELECT 1 FROM "_prisma_migrations"
        WHERE migration_name = '20261019200000_patient_self_service_read'
          AND finished_at IS NOT NULL
          AND rolled_back_at IS NULL
      ) AS "patientSelfServiceMigrationApplied",
      EXISTS (
        SELECT 1 FROM "_prisma_migrations"
        WHERE migration_name = '20261021120000_appointment_cancellation'
          AND finished_at IS NOT NULL
          AND rolled_back_at IS NULL
      ) AS "appointmentCancellationMigrationApplied",
      EXISTS (
        SELECT 1 FROM "_prisma_migrations"
        WHERE migration_name = '20261021130000_restore_audit_event_runtime_grant'
          AND finished_at IS NOT NULL
          AND rolled_back_at IS NULL
      ) AS "auditEventGrantMigrationApplied",
      EXISTS (
        SELECT 1 FROM "_prisma_migrations"
        WHERE migration_name = '20261021140000_appointment_rescheduling'
          AND finished_at IS NOT NULL
          AND rolled_back_at IS NULL
      ) AS "appointmentReschedulingMigrationApplied",
      has_column_privilege('jr_xpert_app', 'public."Session"', 'activeMembershipId', 'UPDATE') AS "sessionScopeUpdate",
      EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jr_xpert_app') AS "appRoleExists",
      (SELECT rolsuper FROM pg_roles WHERE rolname = 'jr_xpert_app') AS "appRoleSuperuser",
      (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'jr_xpert_app') AS "appRoleBypassRls",
      (SELECT relrowsecurity FROM pg_class WHERE oid = 'public."Patient"'::regclass) AS "patientRlsEnabled",
      (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public."Patient"'::regclass) AS "patientRlsForced",
      (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public."PatientAccessGrant"')) AS "accessGrantRlsEnabled",
      (SELECT relforcerowsecurity FROM pg_class WHERE oid = to_regclass('public."PatientAccessGrant"')) AS "accessGrantRlsForced",
      has_table_privilege('jr_xpert_app', 'public."PatientAccessGrant"', 'SELECT') AS "accessGrantSelect",
      has_table_privilege('jr_xpert_app', 'public."AuditEvent"', 'INSERT') AS "auditEventInsert",
      has_column_privilege('jr_xpert_app', 'public."Appointment"', 'status', 'UPDATE') AS "appointmentStatusUpdate",
      has_column_privilege('jr_xpert_app', 'public."Appointment"', 'startsAt', 'UPDATE') AS "appointmentStartsAtUpdate",
      has_column_privilege('jr_xpert_app', 'public."Appointment"', 'durationMinutes', 'UPDATE') AS "appointmentDurationUpdate",
      EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'Appointment'
          AND policyname = 'Appointment_hospital_scope_cancel'
      ) AS "appointmentCancelPolicy",
      EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'Appointment'
          AND policyname = 'Appointment_hospital_scope_reschedule'
      ) AS "appointmentReschedulePolicy",
      EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'Patient'
          AND policyname = 'Patient_explicit_grant_select'
      ) AS "patientGrantPolicy",
      EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'PatientAccessGrant'
          AND policyname = 'PatientAccessGrant_own_active_select'
      ) AS "ownActiveGrantPolicy"
  `);
  const state = rows[0];
  console.log(`Neon runtime-role verification: ${JSON.stringify(state)}`);
  const valid = state?.membershipMigrationApplied === true
    && state.patientSelfServiceMigrationApplied === true
    && state.appointmentCancellationMigrationApplied === true
    && state.auditEventGrantMigrationApplied === true
    && state.appointmentReschedulingMigrationApplied === true
    && state.sessionScopeUpdate === true
    && state.appRoleExists === true
    && state.appRoleSuperuser === false
    && state.appRoleBypassRls === false
    && state.patientRlsEnabled === true
    && state.patientRlsForced === true
    && state.accessGrantRlsEnabled === true
    && state.accessGrantRlsForced === true
    && state.accessGrantSelect === true
    && state.auditEventInsert === true
    && state.appointmentStatusUpdate === true
    && state.appointmentStartsAtUpdate === true
    && state.appointmentDurationUpdate === true
    && state.appointmentCancelPolicy === true
    && state.appointmentReschedulePolicy === true
    && state.patientGrantPolicy === true
    && state.ownActiveGrantPolicy === true;
  if (!valid) process.exitCode = 1;
} finally {
  await pool.end();
}
