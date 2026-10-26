import {
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class CreateSubscriptionInvitationDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsIn(['user_salon', 'user_tatoueur'])
  role?: 'user_salon' | 'user_tatoueur';

  @IsOptional()
  @IsIn(['PRO', 'BUSINESS'])
  plan?: 'PRO' | 'BUSINESS';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  durationMonths?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  maxUses?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  validityDays?: number;
}

export class UpdateInvitationDurationDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  durationMonths?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  maxUses?: number;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
