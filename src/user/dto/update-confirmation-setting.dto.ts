import { AgendaMode } from '@prisma/client';
import { IsBoolean, IsEnum } from 'class-validator';

export class UpdateConfirmationSettingDto {
  @IsBoolean()
  addConfirmationEnabled: boolean;
}

export class UpdateAppointmentBookingDto {
  @IsEnum(AgendaMode)
  agendaMode: AgendaMode;
}
