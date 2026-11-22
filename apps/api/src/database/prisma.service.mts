import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { securePostgresConnectionString } from "./connection-string.mjs";
import { assertRuntimeDatabaseRole, type RuntimeDatabaseRole } from "./runtime-role.mjs";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL must be configured before the API can access application data.");
    }
    super({ adapter: new PrismaPg({
      connectionString: securePostgresConnectionString(connectionString),
      max: Number(process.env.DB_POOL_MAX ?? 5),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    }) });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  async verifyRuntimeRole(): Promise<void> {
    const roles = await this.$queryRaw<Array<{
      role_name: string;
      is_superuser: boolean;
      bypasses_row_level_security: boolean;
    }>>`
      SELECT
        current_user::text AS role_name,
        COALESCE(role.rolsuper, TRUE) AS is_superuser,
        COALESCE(role.rolbypassrls, TRUE) AS bypasses_row_level_security
      FROM pg_catalog.pg_roles AS role
      WHERE role.rolname = current_user
    `;
    const role = roles[0];
    const verifiedRole: RuntimeDatabaseRole | undefined = role && {
      roleName: role.role_name,
      isSuperuser: role.is_superuser,
      bypassesRowLevelSecurity: role.bypasses_row_level_security,
    };
    assertRuntimeDatabaseRole(verifiedRole);
  }
}
