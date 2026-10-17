import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module.mjs";
import { DatabaseModule } from "./database/database.module.mjs";
import { HealthController } from "./health.controller.mjs";
import { PatientsModule } from "./patients/patients.module.mjs";
import { ApplicationsModule } from "./applications/applications.module.mjs";
import { PlatformModule } from "./applications/platform.module.mjs";
import { AppointmentsModule } from "./appointments/appointments.module.mjs";

@Module({ imports: [DatabaseModule, AuthModule, PatientsModule, AppointmentsModule, ApplicationsModule, PlatformModule], controllers: [HealthController] })
export class AppModule {}
