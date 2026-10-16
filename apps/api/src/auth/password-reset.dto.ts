import { IsEmail, IsString, Matches, MaxLength, MinLength } from "class-validator";

export class PasswordResetRequestDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class PasswordResetDto {
  @IsString()
  @Matches(/^[a-f0-9]{64}$/i)
  token!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}
