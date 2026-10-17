import { Equals, IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min, MinLength } from "class-validator";

export class CreateHospitalApplicationDto {
  @IsString() @MinLength(2) @MaxLength(160)
  hospitalName!: string;

  @IsIn(["GENERAL", "MULTISPECIALTY", "CLINIC", "DIAGNOSTIC", "OTHER"])
  hospitalType!: string;

  @IsEmail() @MaxLength(254)
  officialEmail!: string;

  @IsString() @Matches(/^\+?[0-9 ()-]{7,24}$/)
  contactPhone!: string;

  @IsOptional() @IsUrl({ require_protocol: true }) @MaxLength(255)
  website?: string;

  @IsString() @MinLength(5) @MaxLength(240)
  streetAddress!: string;

  @IsString() @MinLength(2) @MaxLength(100)
  city!: string;

  @IsString() @MinLength(2) @MaxLength(100)
  state!: string;

  @IsString() @MinLength(2) @MaxLength(100)
  country!: string;

  @IsString() @MinLength(3) @MaxLength(20) @Matches(/^[a-zA-Z0-9 -]+$/)
  postalCode!: string;

  @IsInt() @Min(1) @Max(100_000)
  bedCount!: number;

  @IsInt() @Min(1) @Max(500)
  branchCount!: number;

  @IsString() @MinLength(2) @MaxLength(120)
  representativeName!: string;

  @IsString() @MinLength(2) @MaxLength(100)
  representativeDesignation!: string;

  @IsString() @MinLength(2) @MaxLength(120)
  proposedAdminName!: string;

  @IsEmail() @MaxLength(254)
  proposedAdminEmail!: string;

  @IsOptional() @IsString() @MaxLength(60) @Matches(/^[a-zA-Z0-9_-]+$/)
  requestedPlanCode?: string;

  @IsBoolean() @Equals(true)
  termsAccepted!: boolean;
}

export class VerifyHospitalApplicationDto {
  @IsString() @Matches(/^[a-f0-9]{64}$/i)
  token!: string;
}

export class ApplicationDecisionDto {
  @IsIn(["APPROVE", "REJECT", "REQUEST_INFORMATION"])
  decision!: "APPROVE" | "REJECT" | "REQUEST_INFORMATION";

  @IsOptional() @IsString() @MaxLength(1000)
  reason?: string;
}

export class HospitalApplicationQueryDto {
  @IsOptional() @IsIn(["EMAIL_PENDING", "PENDING_REVIEW", "NEEDS_INFORMATION", "APPROVED", "REJECTED"])
  status?: "EMAIL_PENDING" | "PENDING_REVIEW" | "NEEDS_INFORMATION" | "APPROVED" | "REJECTED";
}

export class PrepareInvitationDto {
  @IsString() @Matches(/^[a-f0-9]{64}$/i)
  token!: string;

  @IsString() @MinLength(2) @MaxLength(120)
  displayName!: string;

  @IsString() @MinLength(12) @MaxLength(128)
  password!: string;
}

export class CompleteInvitationDto {
  @IsString() @Matches(/^[a-f0-9]{64}$/i)
  token!: string;

  @IsString() @Matches(/^\d{6}$/)
  mfaCode!: string;
}

export class AcceptExistingInvitationDto {
  @IsString() @Matches(/^[a-f0-9]{64}$/i)
  token!: string;
}
