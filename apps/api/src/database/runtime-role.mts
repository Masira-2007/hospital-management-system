export const REQUIRED_RUNTIME_DATABASE_ROLE = "jr_xpert_app";

export type RuntimeDatabaseRole = {
  roleName: string;
  isSuperuser: boolean;
  bypassesRowLevelSecurity: boolean;
};

/** Reject a runtime credential that could bypass tenant row-level security. */
export function assertRuntimeDatabaseRole(role: RuntimeDatabaseRole | undefined): void {
  if (
    !role
    || role.roleName !== REQUIRED_RUNTIME_DATABASE_ROLE
    || role.isSuperuser
    || role.bypassesRowLevelSecurity
  ) {
    throw new Error(
      `Production DATABASE_URL must authenticate as the restricted ${REQUIRED_RUNTIME_DATABASE_ROLE} role without SUPERUSER or BYPASSRLS privileges.`,
    );
  }
}
