import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.mjs";
import { SuperAdminGuard } from "../auth/super-admin.guard.mjs";
import { PlatformController } from "./platform.controller.mjs";
import { PlatformBootstrapController } from "./platform-bootstrap.controller.mjs";

@Module({ imports: [AuthModule], controllers: [PlatformController, PlatformBootstrapController], providers: [SuperAdminGuard] })
export class PlatformModule {}
