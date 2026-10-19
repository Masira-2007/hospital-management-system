import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength } from "class-validator";

export class OAuthStartDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43,128}$/)
  state!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43,128}$/)
  nonce!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  codeChallenge!: string;

  @IsIn(["HOSPITAL", "PATIENT", "SUPER_ADMIN"])
  mode!: "HOSPITAL" | "PATIENT" | "SUPER_ADMIN";

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}

export class OAuthCallbackDto {
  @IsString()
  @MaxLength(4096)
  code!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43,128}$/)
  state!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43,128}$/)
  nonce!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9._~-]{43,128}$/)
  codeVerifier!: string;
}
