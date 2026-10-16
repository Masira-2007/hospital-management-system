import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthController } from "./health.controller.js";
import { PatientsModule } from "./patients/patients.module.js";

@Module({ imports: [DatabaseModule, AuthModule, PatientsModule], controllers: [HealthController] })
export class AppModule {}
