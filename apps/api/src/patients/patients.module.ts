import { Module } from "@nestjs/common";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import { TenantMembershipGuard } from "../auth/tenant-membership.guard.js";
import { PatientsController } from "./patients.controller.js";

@Module({
  controllers: [PatientsController],
  providers: [SessionAuthGuard, TenantMembershipGuard],
})
export class PatientsModule {}
