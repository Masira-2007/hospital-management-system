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
  @IsIn(["HOSPITAL", "PATIENT"])
  mode?: "HOSPITAL" | "PATIENT";

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;

  @IsOptional()
  @Matches(/^\d{6}$/)
  mfaCode?: string;
}
