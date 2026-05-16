import { IsArray, IsBoolean, IsDateString, IsEmail, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateClientDto {
  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  @IsEmail()
  email!: string;

  @IsString()
  phone!: string;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsString()
  address?: string;

  // Consentement et RGPD
  @IsOptional() @IsBoolean() consentSigned?: boolean;
  @IsOptional() @IsDateString() consentSignedAt?: string;
  @IsOptional() @IsString() consentFileUrl?: string;
  @IsOptional() @IsBoolean() isMinor?: boolean;
  @IsOptional() @IsString() guardianName?: string;
  @IsOptional() @IsString() guardianPhone?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsBoolean() marketingConsent?: boolean;

  // Infos Tatouage
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() zone?: string;
  @IsOptional() @IsString() size?: string;
  @IsOptional() @IsString() colorStyle?: string;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() sketch?: string;
  @IsOptional() @IsNumber() estimatedPrice?: number;

  // Historique médical
  @IsOptional() @IsString() allergies?: string;
  @IsOptional() @IsString() healthIssues?: string;
  @IsOptional() @IsString() medications?: string;
  @IsOptional() @IsBoolean() pregnancy?: boolean;
  @IsOptional() @IsString() previousReactions?: string;
  @IsOptional() @IsString() tattooHistory?: string;
}
