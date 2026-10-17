import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.mjs";
import { HospitalApplicationsController } from "./hospital-applications.controller.mjs";
import { HospitalInvitationsController } from "./hospital-invitations.controller.mjs";

@Module({ imports: [AuthModule], controllers: [HospitalApplicationsController, HospitalInvitationsController] })
export class ApplicationsModule {}
