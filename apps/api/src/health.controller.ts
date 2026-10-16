import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { PrismaService } from "./database/prisma.service";

@ApiTags("platform")
@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: "Check that the API process is responding" })
  getHealth() {
    return {
      status: "ok",
      service: "jr-xpert-hms-api",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
    };
  }

  @Get("ready")
  @ApiOperation({ summary: "Check API and database readiness without exposing configuration" })
  async getReadiness() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: "ready", service: "jr-xpert-hms-api", timestamp: new Date().toISOString() };
    } catch {
      throw new ServiceUnavailableException({ code: "SERVICE_NOT_READY", message: "Service is temporarily unavailable." });
    }
  }
}
