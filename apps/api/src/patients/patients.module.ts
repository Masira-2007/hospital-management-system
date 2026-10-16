import { Module } from "@nestjs/common";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { TenantMembershipGuard } from "../auth/tenant-membership.guard";
import { PatientsController } from "./patients.controller";

@Module({
  controllers: [PatientsController],
  providers: [SessionAuthGuard, TenantMembershipGuard],
})
export class PatientsModule {}
