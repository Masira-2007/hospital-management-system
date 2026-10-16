import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module.mjs";
import { DatabaseModule } from "./database/database.module.mjs";
import { HealthController } from "./health.controller.mjs";
import { PatientsModule } from "./patients/patients.module.mjs";

@Module({ imports: [DatabaseModule, AuthModule, PatientsModule], controllers: [HealthController] })
export class AppModule {}
