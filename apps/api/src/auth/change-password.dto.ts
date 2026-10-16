import { IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

export class ChangePasswordDto {
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  currentPassword!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  newPassword!: string;

  @IsOptional()
  @Matches(/^\d{6}$/)
  mfaCode?: string;
}
