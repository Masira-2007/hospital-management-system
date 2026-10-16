import { Module } from "@nestjs/common";
import { SessionAuthGuard } from "../auth/session-auth.guard.mjs";
import { TenantMembershipGuard } from "../auth/tenant-membership.guard.mjs";
import { PatientsController } from "./patients.controller.mjs";

@Module({
  controllers: [PatientsController],
  providers: [SessionAuthGuard, TenantMembershipGuard],
})
export class PatientsModule {}
