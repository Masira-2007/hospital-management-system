import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { DatabaseModule } from "./database/database.module";
import { HealthController } from "./health.controller";
import { PatientsModule } from "./patients/patients.module";

@Module({ imports: [DatabaseModule, AuthModule, PatientsModule], controllers: [HealthController] })
export class AppModule {}
