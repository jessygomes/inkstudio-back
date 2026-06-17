import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CreateAppointmentDto } from './create-appointment.dto';

export class CreateAppointmentByClientRequestDto {
  @ApiProperty({ description: 'ID du salon cible' })
  userId: string;

  @ApiProperty({ type: CreateAppointmentDto })
  rdvBody: CreateAppointmentDto & { clientUserId?: string };

  @ApiPropertyOptional({ description: 'ID du compte client connecté (optionnel)' })
  clientUserId?: string;
}

export type CreateAppointmentByClientErrorCode = 'LINKED_BOOKING_REDIRECT';

export interface CreateAppointmentByClientResponse {
  error: boolean;
  message: string;
  appointment?: Record<string, any>;
  status?: 'PENDING' | 'CONFIRMED';
  /**
   * Code métier présent uniquement en cas d'erreur liée à un tatoueur linked:
   * LINKED_BOOKING_REDIRECT — rediriger le client vers le profil direct du tatoueur.
   */
  code?: CreateAppointmentByClientErrorCode;
  /** ID du profil tatoueur cible pour la redirection (présent avec LINKED_BOOKING_REDIRECT) */
  performerUserId?: string;
}
