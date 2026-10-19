import dotenv from "dotenv";
import { resolve } from "node:path";
import pg from "pg";

dotenv.config({ path: resolve(process.cwd(), "../../.env"), quiet: true });

const directUrl = process.env.DIRECT_URL;
if (!directUrl) throw new Error("DIRECT_URL is required for the read-only runtime-role verification.");

const pool = new pg.Pool({ connectionString: directUrl, max: 1, connectionTimeoutMillis: 10_000 });
try {
  const { rows } = await pool.query<{
    migrationApplied: boolean;
    sessionScopeUpdate: boolean;
    appRoleExists: boolean;
    appRoleSuperuser: boolean | null;
    appRoleBypassRls: boolean | null;
    patientRlsEnabled: boolean;
    patientRlsForced: boolean;
  }>(`
    SELECT
      EXISTS (
        SELECT 1 FROM "_prisma_migrations"
        WHERE migration_name = '20261019160000_session_membership_selection'
          AND finished_at IS NOT NULL
          AND rolled_back_at IS NULL
      ) AS "migrationApplied",
      has_column_privilege('jr_xpert_app', 'public."Session"', 'activeMembershipId', 'UPDATE') AS "sessionScopeUpdate",
      EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jr_xpert_app') AS "appRoleExists",
      (SELECT rolsuper FROM pg_roles WHERE rolname = 'jr_xpert_app') AS "appRoleSuperuser",
      (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'jr_xpert_app') AS "appRoleBypassRls",
      (SELECT relrowsecurity FROM pg_class WHERE oid = 'public."Patient"'::regclass) AS "patientRlsEnabled",
      (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public."Patient"'::regclass) AS "patientRlsForced"
  `);
  const state = rows[0];
  console.log(`Neon runtime-role verification: ${JSON.stringify(state)}`);
  const valid = state?.migrationApplied === true
    && state.sessionScopeUpdate === true
    && state.appRoleExists === true
    && state.appRoleSuperuser === false
    && state.appRoleBypassRls === false
    && state.patientRlsEnabled === true
    && state.patientRlsForced === true;
  if (!valid) process.exitCode = 1;
} finally {
  await pool.end();
}
