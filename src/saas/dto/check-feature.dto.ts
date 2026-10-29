import { IsIn, IsString } from 'class-validator';

export class CheckFeatureDto {
  @IsString()
  @IsIn(['advancedStats', 'emailReminders', 'customBranding', 'apiAccess'])
  feature: 'advancedStats' | 'emailReminders' | 'customBranding' | 'apiAccess';
}
