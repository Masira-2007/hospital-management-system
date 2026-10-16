import dotenv from "dotenv";
import { resolve } from "node:path";
import { defineConfig } from "prisma/config";

dotenv.config({ path: resolve(process.cwd(), "../../.env") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "postgresql://jr_xpert:jr_xpert_dev@localhost:5432/jr_xpert_hms?schema=public",
  },
});
