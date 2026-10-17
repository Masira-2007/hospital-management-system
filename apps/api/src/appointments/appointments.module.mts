import { Module } from "@nestjs/common";
import { SessionAuthGuard } from "../auth/session-auth.guard.mjs";
import { TenantMembershipGuard } from "../auth/tenant-membership.guard.mjs";
import { AppointmentsController } from "./appointments.controller.mjs";

@Module({ controllers: [AppointmentsController], providers: [SessionAuthGuard, TenantMembershipGuard] })
export class AppointmentsModule {}
