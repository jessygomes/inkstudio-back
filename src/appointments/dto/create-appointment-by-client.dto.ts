import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { CreateAppointmentDto } from './create-appointment.dto';

export class CreateAppointmentByClientRequestDto {
  @ApiProperty({ description: 'ID du salon cible' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiPropertyOptional({ description: 'Alias de compatibilite de userId' })
  @IsOptional()
  @IsString()
  salonId?: string;

  @ApiProperty({ type: CreateAppointmentDto })
  @ValidateNested()
  @Type(() => CreateAppointmentDto)
  rdvBody: CreateAppointmentDto;

  @ApiPropertyOptional({ description: 'Champ de compatibilité : doit correspondre au compte client authentifié par JWT. Ne sert jamais de preuve d’identité.' })
  @IsOptional()
  @IsString()
  clientUserId?: string;
}

export type CreateAppointmentByClientErrorCode =
  | 'LINKED_BOOKING_REDIRECT'
  // Fiche du salon déjà associée à cet e-mail : se connecter / créer un compte avec cette adresse, confirmer l'e-mail, ou contacter le salon.
  | 'CLIENT_EMAIL_KNOWN'
  | 'CLIENT_EMAIL_UNVERIFIED'
  | 'CLIENT_EMAIL_LINKED_ELSEWHERE';

export interface CreateAppointmentByClientResponse {
  error: boolean;
  message: string;
  appointment?: Record<string, any>;
  status?: 'PENDING' | 'CONFIRMED';
  visioSecurityInstruction?: string;
  /**
   * Code métier présent uniquement en cas d'erreur liée à un tatoueur linked:
   * LINKED_BOOKING_REDIRECT — rediriger le client vers le profil direct du tatoueur.
   */
  code?: CreateAppointmentByClientErrorCode;
  /** ID du profil tatoueur cible pour la redirection (présent avec LINKED_BOOKING_REDIRECT) */
  performerUserId?: string;
}
