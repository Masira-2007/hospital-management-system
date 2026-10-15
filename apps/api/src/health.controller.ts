import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

@ApiTags("platform")
@Controller("health")
export class HealthController {
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
}
