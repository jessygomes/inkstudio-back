import { IsString, IsNumber, IsOptional, IsBoolean, IsEnum } from 'class-validator';
import { PiercingZoneOreille, PiercingZoneVisage, PiercingZoneBouche, PiercingZoneCorps, PiercingZoneMicrodermal } from '@prisma/client';

export class CreatePiercingServicePriceDto {
  @IsString()
  piercingPriceId: string;

  @IsOptional()
  @IsEnum(PiercingZoneOreille)
  piercingZoneOreille?: PiercingZoneOreille;

  @IsOptional()
  @IsEnum(PiercingZoneVisage)
  piercingZoneVisage?: PiercingZoneVisage;

  @IsOptional()
  @IsEnum(PiercingZoneBouche)
  piercingZoneBouche?: PiercingZoneBouche;

  @IsOptional()
  @IsEnum(PiercingZoneCorps)
  piercingZoneCorps?: PiercingZoneCorps;

  @IsOptional()
  @IsEnum(PiercingZoneMicrodermal)
  piercingZoneMicrodermal?: PiercingZoneMicrodermal;

  @IsNumber()
  price: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
