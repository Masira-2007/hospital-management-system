import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { SessionAuthGuard } from "./session-auth.guard.js";
import { TenantMembershipGuard } from "./tenant-membership.guard.js";
import { EmailDeliveryService } from "./email-delivery.service.js";

@Module({
  controllers: [AuthController],
  providers: [SessionAuthGuard, TenantMembershipGuard, EmailDeliveryService],
  exports: [SessionAuthGuard, TenantMembershipGuard],
})
export class AuthModule {}
