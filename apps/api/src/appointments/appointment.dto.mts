import { Type } from "class-transformer";
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator";

const APPOINTMENT_STATUSES = ["REQUESTED", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"] as const;

export class AppointmentListDto {
  @IsOptional() @IsDateString()
  from?: string;

  @IsOptional() @IsDateString()
  to?: string;

  @IsOptional() @IsIn(APPOINTMENT_STATUSES)
  status?: typeof APPOINTMENT_STATUSES[number];

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10_000)
  page = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 25;
}

export class CreateAppointmentDto {
  @IsString() @MaxLength(64)
  patientId!: string;

  @IsString() @MaxLength(64)
  doctorMembershipId!: string;

  @IsDateString() @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/)
  startsAt!: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(10) @Max(240)
  durationMinutes = 20;
}
