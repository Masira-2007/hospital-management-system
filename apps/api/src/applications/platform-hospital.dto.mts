import { Type } from "class-transformer";
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from "class-validator";

export class PlatformHospitalQueryDto {
  @IsOptional()
  @IsIn(["PROVISIONING", "ACTIVE", "SUSPENDED", "DEACTIVATED"])
  status?: "PROVISIONING" | "ACTIVE" | "SUSPENDED" | "DEACTIVATED";

  @IsOptional() @IsString() @MaxLength(100)
  search?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10_000)
  page = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize = 25;
}

export class HospitalStatusChangeDto {
  @IsIn(["SUSPEND", "REACTIVATE"])
  action!: "SUSPEND" | "REACTIVATE";

  @IsString() @MinLength(10) @MaxLength(1000)
  reason!: string;
}

export class PlatformAuditQueryDto {
  @IsOptional() @IsString() @MaxLength(100) @Matches(/^[a-zA-Z0-9_.-]+$/)
  action?: string;

  @IsOptional() @IsString() @MaxLength(64) @Matches(/^[a-zA-Z0-9_-]+$/)
  organizationId?: string;

  @IsOptional() @IsDateString()
  from?: string;

  @IsOptional() @IsDateString()
  to?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10_000)
  page = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize = 25;
}
