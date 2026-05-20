import { IsBoolean, IsDateString, IsOptional, IsString } from 'class-validator';

export class UpdateClientConsentDto {
  @IsOptional()
  @IsBoolean()
  consentSigned?: boolean;

  @IsOptional()
  @IsDateString()
  consentSignedAt?: string;

  @IsOptional()
  @IsString()
  consentFileUrl?: string;
}
