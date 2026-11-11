import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ProjectClientInfoDto {
  @ApiPropertyOptional({ description: 'Budget minimum en centimes EUR', nullable: true, example: 20000 })
  @IsOptional() @IsInt() @Min(0) @Max(2147483647)
  projectBudgetMinCents?: number | null;

  @ApiPropertyOptional({ description: 'Budget maximum en centimes EUR', nullable: true, example: 50000 })
  @IsOptional() @IsInt() @Min(0) @Max(2147483647)
  projectBudgetMaxCents?: number | null;

  @ApiPropertyOptional({ description: 'Premier tatouage ? null = non renseigné', nullable: true })
  @IsOptional() @IsBoolean()
  isFirstTattoo?: boolean | null;
}
