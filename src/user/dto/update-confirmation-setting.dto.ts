import { AgendaMode } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, Min, ValidateIf } from 'class-validator';

export class UpdateConfirmationSettingDto {
  @IsBoolean()
  addConfirmationEnabled: boolean;
}

export class UpdateAppointmentBookingDto {
  @IsOptional()
  @IsEnum(AgendaMode)
  agendaMode?: AgendaMode;

  @IsOptional()
  @IsInt()
  @Min(15)
  projectAppointmentDurationMinutes?: number;

  @IsOptional()
  @IsBoolean()
  projectAppointmentIsFree?: boolean;

  @ValidateIf((o: UpdateAppointmentBookingDto) => o.projectAppointmentIsFree === false)
  @IsNumber()
  @Min(0)
  projectAppointmentPrice?: number;
}
