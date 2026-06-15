import { IsBoolean } from 'class-validator';

export class UpdateLinkedTatoueurAppointmentBookingDto {
  @IsBoolean()
  appointmentBookingEnabled: boolean;
}
