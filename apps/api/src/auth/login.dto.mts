import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsIn(["HOSPITAL", "PATIENT", "SUPER_ADMIN"])
  mode?: "HOSPITAL" | "PATIENT" | "SUPER_ADMIN";

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;

  @IsOptional()
  @Matches(/^[a-f0-9]{64}$/i)
  challengeToken?: string;

  @IsOptional()
  @Matches(/^\d{6}$/)
  emailCode?: string;
}
