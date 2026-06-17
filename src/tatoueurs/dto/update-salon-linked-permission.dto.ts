import { IsBoolean } from 'class-validator';

/**
 * DTO générique pour toggler une permission entre un user_tatoueur lié et son user_salon
 *
 * Utilisé par les deux routes de gestion des permissions :
 * - PATCH /team-requests/permissions/agenda-access → salonCanViewAppointments
 * - PATCH /team-requests/permissions/salon-appointment-creation → salonCanCreateAppointments
 */
export class UpdateSalonLinkedPermissionDto {
  /** true = permission activée, false = permission désactivée */
  @IsBoolean()
  enabled: boolean;
}
