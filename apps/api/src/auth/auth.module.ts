import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { SessionAuthGuard } from "./session-auth.guard";
import { TenantMembershipGuard } from "./tenant-membership.guard";
import { EmailDeliveryService } from "./email-delivery.service";

@Module({
  controllers: [AuthController],
  providers: [SessionAuthGuard, TenantMembershipGuard, EmailDeliveryService],
  exports: [SessionAuthGuard, TenantMembershipGuard],
})
export class AuthModule {}
