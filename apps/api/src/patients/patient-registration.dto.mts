import { IsDateString, IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

export class PatientRegistrationDto {
  @IsString() @MinLength(1) @MaxLength(100) @Matches(/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u)
  firstName!: string;

  @IsString() @MinLength(1) @MaxLength(100) @Matches(/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u)
  lastName!: string;

  @IsOptional() @IsDateString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateOfBirth?: string;

  @IsOptional() @IsString() @MaxLength(32) @Matches(/^\+?[0-9][0-9 ()-]{5,30}$/)
  phone?: string;

  @IsOptional() @IsEmail() @MaxLength(254)
  email?: string;
}
