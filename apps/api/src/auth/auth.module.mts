import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.mjs";
import { SessionAuthGuard } from "./session-auth.guard.mjs";
import { TenantMembershipGuard } from "./tenant-membership.guard.mjs";
import { EmailDeliveryService } from "./email-delivery.service.mjs";

@Module({
  controllers: [AuthController],
  providers: [SessionAuthGuard, TenantMembershipGuard, EmailDeliveryService],
  exports: [SessionAuthGuard, TenantMembershipGuard],
})
export class AuthModule {}
