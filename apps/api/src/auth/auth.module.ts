import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { SessionAuthGuard } from "./session-auth.guard";
import { TenantMembershipGuard } from "./tenant-membership.guard";

@Module({
  controllers: [AuthController],
  providers: [SessionAuthGuard, TenantMembershipGuard],
  exports: [SessionAuthGuard, TenantMembershipGuard],
})
export class AuthModule {}
