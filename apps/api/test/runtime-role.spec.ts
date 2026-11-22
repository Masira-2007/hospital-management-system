import assert from "node:assert/strict";
import test from "node:test";
import { assertRuntimeDatabaseRole, REQUIRED_RUNTIME_DATABASE_ROLE } from "../src/database/runtime-role.mjs";

test("accepts only the restricted application role for production runtime", () => {
  assert.doesNotThrow(() => assertRuntimeDatabaseRole({
    roleName: REQUIRED_RUNTIME_DATABASE_ROLE,
    isSuperuser: false,
    bypassesRowLevelSecurity: false,
  }));
});

test("rejects the database owner role instead of running the app with elevated access", () => {
  assert.throws(() => assertRuntimeDatabaseRole({
    roleName: "neondb_owner",
    isSuperuser: false,
    bypassesRowLevelSecurity: false,
  }), /must authenticate as the restricted jr_xpert_app role/);
});

test("rejects the app role if PostgreSQL grants it SUPERUSER or BYPASSRLS", () => {
  for (const role of [
    { roleName: REQUIRED_RUNTIME_DATABASE_ROLE, isSuperuser: true, bypassesRowLevelSecurity: false },
    { roleName: REQUIRED_RUNTIME_DATABASE_ROLE, isSuperuser: false, bypassesRowLevelSecurity: true },
  ]) {
    assert.throws(() => assertRuntimeDatabaseRole(role), /without SUPERUSER or BYPASSRLS/);
  }
});

test("fails closed when PostgreSQL does not expose the current role metadata", () => {
  assert.throws(() => assertRuntimeDatabaseRole(undefined), /restricted jr_xpert_app role/);
});
