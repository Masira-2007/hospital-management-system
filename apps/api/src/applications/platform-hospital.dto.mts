import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

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
