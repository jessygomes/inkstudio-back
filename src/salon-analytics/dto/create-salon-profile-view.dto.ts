import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSalonProfileViewDto {
  @IsString()
  @MaxLength(191)
  salonId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  ipHash?: string; // Hash de l'IP (SHA-256 ou similaire)

  @IsOptional()
  @IsString()
  @MaxLength(500)
  referrer?: string; // Source du trafic

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  userAgent?: string; // User-Agent du navigateur

  @IsOptional()
  @IsString()
  @MaxLength(50)
  deviceType?: string; // DESKTOP, MOBILE, TABLET

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string; // Pays détecté

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string; // Ville détectée
}
