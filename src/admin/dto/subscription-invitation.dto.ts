import { IsEmail, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class CreateSubscriptionInvitationDto {
  @IsEmail()
  email: string;

  @IsIn(['user_salon', 'user_tatoueur'])
  role: 'user_salon' | 'user_tatoueur';

  @IsIn(['PRO', 'BUSINESS'])
  plan: 'PRO' | 'BUSINESS';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  durationMonths?: number;
}

export class UpdateInvitationDurationDto {
  @IsInt()
  @Min(1)
  @Max(120)
  durationMonths: number;
}
