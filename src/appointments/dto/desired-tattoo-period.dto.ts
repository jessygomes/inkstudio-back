import { IsEnum, IsOptional, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { DesiredTattooPeriod } from '@prisma/client';
import { ProjectClientInfoDto } from './project-client-info.dto';

export class DesiredTattooPeriodDto extends ProjectClientInfoDto {
  @ApiPropertyOptional({ enum: DesiredTattooPeriod, nullable: true })
  @IsOptional()
  @IsEnum(DesiredTattooPeriod)
  desiredTattooPeriod?: DesiredTattooPeriod | null;

  @ApiPropertyOptional({ example: '2027-04-10', nullable: true })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  desiredTattooDate?: string | null;

  @ApiPropertyOptional({ example: '2027-04-01', nullable: true })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  desiredTattooStartDate?: string | null;

  @ApiPropertyOptional({ example: '2027-04-30', nullable: true })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  desiredTattooEndDate?: string | null;
}
