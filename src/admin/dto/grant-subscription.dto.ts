import {
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class GrantSubscriptionDto {
  @IsInt()
  @Min(1)
  @Max(3650)
  duration: number;

  @IsIn(['MONTHS', 'DAYS'])
  unit: 'MONTHS' | 'DAYS';

  @IsOptional()
  @Matches(/^[a-f0-9]{64}$/)
  confirmation?: string;

  @IsOptional()
  @IsUUID('4')
  requestId?: string;
}
