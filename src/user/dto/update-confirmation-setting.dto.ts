import { IsBoolean } from 'class-validator';

export class UpdateConfirmationSettingDto {
  @IsBoolean()
  addConfirmationEnabled: boolean;
}
