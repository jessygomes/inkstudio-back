import { IsEnum, IsOptional, IsBoolean } from 'class-validator';
import { PiercingZone } from '@prisma/client';

export class CreatePiercingPriceDto {
  @IsEnum(PiercingZone)
  piercingZone: PiercingZone;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
