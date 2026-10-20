import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool, type PoolClient } from "pg";

const ownerUrl = process.env.TENANT_ISOLATION_TEST_OWNER_URL;
const appUrl = process.env.TENANT_ISOLATION_TEST_APP_URL;
const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const testDatabaseName = "jr_xpert_hms_test";
const missingTestUrls = !ownerUrl || !appUrl;

function assertLocalTestUrl(value: string | undefined, expectedUser: string): URL {
  assert.ok(value, `Set ${expectedUser === "jr_xpert_app" ? "TENANT_ISOLATION_TEST_APP_URL" : "TENANT_ISOLATION_TEST_OWNER_URL"} to the local test database URL.`);
  const url = new URL(value);
  assert.ok(localHosts.has(url.hostname), "Tenant-isolation integration tests only connect to a local PostgreSQL host.");
  assert.equal(decodeURIComponent(url.pathname.slice(1)), testDatabaseName, "Refusing to use a database other than jr_xpert_hms_test.");
  assert.equal(decodeURIComponent(url.username), expectedUser, "The test connection uses the wrong database role.");
  return url;
}

if (!missingTestUrls) {
  const ownerTarget = assertLocalTestUrl(ownerUrl, "jr_xpert_test_owner");
  const appTarget = assertLocalTestUrl(appUrl, "jr_xpert_app");
  assert.equal(ownerTarget.host, appTarget.host, "Fixture and application connections must target the same local test server.");
  assert.equal(ownerTarget.pathname, appTarget.pathname, "Fixture and application connections must target the same dedicated test database.");
}

type TenantContext = { userId: string; organizationId: string; hospitalId: string };

async function withTenant<T>(pool: Pool, tenant: TenantContext, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT set_config('app.user_id', $1, true),
              set_config('app.organization_id', $2, true),
              set_config('app.hospital_id', $3, true),
              set_config('app.branch_id', '', true)`,
      [tenant.userId, tenant.organizationId, tenant.hospitalId],
    );
    return await operation(client);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

async function expectDenied(client: PoolClient, operation: () => Promise<unknown>): Promise<void> {
  await client.query("SAVEPOINT expected_denial");
  let denied = false;
  try {
    await operation();
  } catch (error) {
    assert.equal((error as { code?: string }).code, "42501", "The write must be denied by database privileges or row-level security.");
    denied = true;
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT expected_denial");
    await client.query("RELEASE SAVEPOINT expected_denial");
  }
  assert.ok(denied, "Expected PostgreSQL to reject this unauthorized write.");
}

async function createFixtures(owner: Pool) {
  const suffix = randomUUID().replaceAll("-", "");
  const ids = {
    organizations: [`ti_org_a_${suffix}`, `ti_org_b_${suffix}`],
    hospitals: [`ti_hospital_a_${suffix}`, `ti_hospital_b_${suffix}`],
    staff: [`ti_staff_a_${suffix}`, `ti_staff_b_${suffix}`],
    patients: [`ti_patient_user_a_${suffix}`, `ti_patient_user_b_${suffix}`],
    doctors: [`ti_doctor_a_${suffix}`, `ti_doctor_b_${suffix}`],
    memberships: [`ti_staff_membership_a_${suffix}`, `ti_staff_membership_b_${suffix}`, `ti_patient_membership_a_${suffix}`, `ti_patient_membership_b_${suffix}`, `ti_doctor_membership_a_${suffix}`, `ti_doctor_membership_b_${suffix}`],
    records: [`ti_record_a_${suffix}`, `ti_record_b_${suffix}`],
    grants: [`ti_grant_a_${suffix}`, `ti_grant_b_${suffix}`],
    appointments: [`ti_appointment_a_${suffix}`, `ti_appointment_b_${suffix}`],
  };
  const now = new Date();
  const client = await owner.connect();
  try {
    await client.query("BEGIN");
    for (let index = 0; index < 2; index += 1) {
      const orgId = ids.organizations[index];
      const hospitalId = ids.hospitals[index];
      await client.query(
        `INSERT INTO "Organization" ("id", "name", "slug", "status", "updatedAt")
         VALUES ($1, $2, $3, 'ACTIVE', $4)`,
        [orgId, `Synthetic Isolation Organization ${index + 1}`, `${suffix}-${index}`, now],
      );
      await client.query(
        `INSERT INTO "Hospital" ("id", "organizationId", "name", "slug", "status")
         VALUES ($1, $2, $3, $4, 'ACTIVE')`,
        [hospitalId, orgId, `Synthetic Isolation Hospital ${index + 1}`, `hospital-${suffix}-${index}`],
      );

      const accountIds = [ids.staff[index], ids.patients[index], ids.doctors[index]];
      const accountRoles = ["HOSPITAL_ADMIN", "PATIENT", "DOCTOR"] as const;
      const membershipIds = [ids.memberships[index], ids.memberships[index + 2], ids.memberships[index + 4]];
      for (let accountIndex = 0; accountIndex < accountIds.length; accountIndex += 1) {
        const userId = accountIds[accountIndex];
        const email = `${userId}@example.invalid`;
        await client.query(
          `INSERT INTO "User" ("id", "email", "passwordHash", "displayName", "status", "emailVerifiedAt", "updatedAt")
           VALUES ($1, $2, $3, $4, 'ACTIVE', $5, $5)`,
          [userId, email, "synthetic-test-hash-not-a-login-credential", `Synthetic User ${accountIndex + 1}`, now],
        );
        await client.query(
          `INSERT INTO "Membership" ("id", "userId", "organizationId", "hospitalId", "role", "status")
           VALUES ($1, $2, $3, $4, $5::"MembershipRole", 'ACTIVE')`,
          [membershipIds[accountIndex], userId, orgId, hospitalId, accountRoles[accountIndex]],
        );
      }

      const patientId = ids.records[index];
      await client.query(
        `INSERT INTO "Patient" ("id", "organizationId", "hospitalId", "mrn", "firstName", "lastName", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [patientId, orgId, hospitalId, `ISO-${suffix}-${index}`, `Synthetic${index}`, "Patient", now],
      );
      await client.query(
        `INSERT INTO "PatientAccessGrant" ("id", "userId", "patientId", "organizationId", "relationship", "canViewRecords")
         VALUES ($1, $2, $3, $4, 'SELF', true)`,
        [ids.grants[index], ids.patients[index], patientId, orgId],
      );
      await client.query(
        `INSERT INTO "Appointment" ("id", "organizationId", "hospitalId", "patientId", "doctorMembershipId", "startsAt", "durationMinutes", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, 20, $7)`,
        [ids.appointments[index], orgId, hospitalId, patientId, ids.memberships[index + 4], new Date(now.getTime() + (index + 1) * 60 * 60 * 1000), now],
      );
    }
    await client.query("COMMIT");
    return ids;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function deleteFixtures(owner: Pool, ids: Awaited<ReturnType<typeof createFixtures>>) {
  const client = await owner.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM "Appointment" WHERE "id" = ANY($1::text[])`, [ids.appointments]);
    await client.query(`DELETE FROM "PatientAccessGrant" WHERE "id" = ANY($1::text[])`, [ids.grants]);
    await client.query(`DELETE FROM "Patient" WHERE "id" = ANY($1::text[])`, [ids.records]);
    await client.query(`DELETE FROM "Membership" WHERE "id" = ANY($1::text[])`, [ids.memberships]);
    await client.query(`DELETE FROM "User" WHERE "id" = ANY($1::text[])`, [[...ids.staff, ...ids.patients, ...ids.doctors]]);
    await client.query(`DELETE FROM "Hospital" WHERE "id" = ANY($1::text[])`, [ids.hospitals]);
    await client.query(`DELETE FROM "Organization" WHERE "id" = ANY($1::text[])`, [ids.organizations]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

test("two synthetic hospitals cannot read or modify each other's patient or appointment rows", {
  skip: missingTestUrls
    ? "Local PostgreSQL test URLs are not configured. Start the isolated postgres-test service and set both TENANT_ISOLATION_TEST_*_URL variables; see README.md."
    : false,
}, async () => {
  const owner = new Pool({ connectionString: ownerUrl!, max: 2 });
  const app = new Pool({ connectionString: appUrl!, max: 2 });
  let fixtureIds: Awaited<ReturnType<typeof createFixtures>> | undefined;
  try {
    const ownerState = await owner.query("SELECT current_database() AS db, current_user AS role");
    assert.equal(ownerState.rows[0].db, testDatabaseName);
    assert.equal(ownerState.rows[0].role, "jr_xpert_test_owner");
    const appState = await app.query(
      `SELECT current_database() AS db, current_user AS role, r.rolsuper AS superuser, r.rolbypassrls AS bypassrls
       FROM pg_roles r WHERE r.rolname = current_user`,
    );
    assert.equal(appState.rows[0].db, testDatabaseName);
    assert.equal(appState.rows[0].role, "jr_xpert_app");
    assert.equal(appState.rows[0].superuser, false);
    assert.equal(appState.rows[0].bypassrls, false);

    fixtureIds = await createFixtures(owner);
    const [organizationA, organizationB] = fixtureIds.organizations;
    const [hospitalA, hospitalB] = fixtureIds.hospitals;
    const [staffA] = fixtureIds.staff;
    const [patientUserA] = fixtureIds.patients;
    const [patientA, patientB] = fixtureIds.records;
    const [grantA, grantB] = fixtureIds.grants;
    const [appointmentA, appointmentB] = fixtureIds.appointments;

    await withTenant(app, { userId: patientUserA, organizationId: organizationA, hospitalId: hospitalA }, async (client) => {
      const visible = await client.query(`SELECT "id" FROM "Patient" WHERE "id" = ANY($1::text[]) ORDER BY "id"`, [[patientA, patientB]]);
      assert.deepEqual(visible.rows.map(({ id }) => id), [patientA]);
      const grants = await client.query(`SELECT "id" FROM "PatientAccessGrant" WHERE "id" = ANY($1::text[])`, [[grantA, grantB]]);
      assert.deepEqual(grants.rows.map(({ id }) => id), [grantA]);
    });

    await withTenant(app, { userId: staffA, organizationId: organizationA, hospitalId: hospitalA }, async (client) => {
      const patientRows = await client.query(`SELECT "id" FROM "Patient" WHERE "id" = ANY($1::text[])`, [[patientA, patientB]]);
      assert.deepEqual(patientRows.rows.map(({ id }) => id), [patientA]);
      const appointmentRows = await client.query(`SELECT "id" FROM "Appointment" WHERE "id" = ANY($1::text[])`, [[appointmentA, appointmentB]]);
      assert.deepEqual(appointmentRows.rows.map(({ id }) => id), [appointmentA]);
    });

    await withTenant(app, { userId: staffA, organizationId: organizationB, hospitalId: hospitalB }, async (client) => {
      const patientRows = await client.query(`SELECT "id" FROM "Patient" WHERE "id" = $1`, [patientB]);
      assert.equal(patientRows.rowCount, 0, "Forged tenant context must not expose a guessed valid patient ID.");
      const appointmentRows = await client.query(`SELECT "id" FROM "Appointment" WHERE "id" = $1`, [appointmentB]);
      assert.equal(appointmentRows.rowCount, 0, "Forged tenant context must not expose a guessed valid appointment ID.");
      await expectDenied(client, () => client.query(
        `INSERT INTO "Patient" ("id", "organizationId", "hospitalId", "mrn", "firstName", "lastName", "updatedAt")
         VALUES ($1, $2, $3, $4, 'Forged', 'Patient', NOW())`,
        [`ti_forged_patient_${randomUUID()}`, organizationB, hospitalB, `FORGED-${randomUUID()}`],
      ));
      await expectDenied(client, () => client.query(
        `INSERT INTO "Appointment" ("id", "organizationId", "hospitalId", "patientId", "doctorMembershipId", "startsAt", "durationMinutes", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, NOW() + interval '10 days', 20, NOW())`,
        [`ti_forged_appointment_${randomUUID()}`, organizationB, hospitalB, patientB, fixtureIds!.memberships[5]],
      ));
      await expectDenied(client, () => client.query(`UPDATE "Patient" SET "firstName" = 'Modified' WHERE "id" = $1`, [patientB]));
      await expectDenied(client, () => client.query(`DELETE FROM "Patient" WHERE "id" = $1`, [patientB]));
      await expectDenied(client, () => client.query(`UPDATE "Appointment" SET "status" = 'COMPLETED' WHERE "id" = $1`, [appointmentB]));
    });
  } finally {
    try {
      if (fixtureIds) await deleteFixtures(owner, fixtureIds);
    } finally {
      await Promise.all([owner.end(), app.end()]);
    }
  }
});
