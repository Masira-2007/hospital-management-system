import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.mjs";
import { SessionAuthGuard } from "./session-auth.guard.mjs";
import { TenantMembershipGuard } from "./tenant-membership.guard.mjs";
import { EmailDeliveryService } from "./email-delivery.service.mjs";
import { OAuthService } from "./oauth.service.mjs";
import { OidcClientService } from "./oidc-client.service.mjs";

@Module({
  controllers: [AuthController],
  providers: [SessionAuthGuard, TenantMembershipGuard, EmailDeliveryService, OAuthService, OidcClientService],
  exports: [SessionAuthGuard, TenantMembershipGuard, EmailDeliveryService, OAuthService, OidcClientService],
})
export class AuthModule {}
