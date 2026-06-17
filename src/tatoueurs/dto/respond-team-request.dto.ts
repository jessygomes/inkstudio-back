import { IsBoolean, IsIn, ValidateIf } from 'class-validator';

/**
 * DTO pour la réponse à une demande d'équipe salon → tatoueur
 * 
 * Lors de l'acceptation, le tatoueur doit explicitement choisir :
 * - s'il autorise le salon à voir son agenda/RDV
 * - s'il autorise le salon à créer des RDV pour lui
 * 
 * Ces choix sont persistés dans les champs User.salonCanViewAppointments
 * et User.salonCanCreateAppointments lors de l'acceptation.
 */
export class RespondTeamRequestDto {
  /** Action à effectuer : 'accept' ou 'refuse' */
  @IsIn(['accept', 'refuse'])
  action!: 'accept' | 'refuse';

  /**
   * Permission 1 : Autoriser le salon lié à voir l'agenda et les RDV du tatoueur
   * Validé UNIQUEMENT si action === 'accept'
   * 
   * Persiste dans User.salonCanViewAppointments après acceptation
   */
  @ValidateIf((o: RespondTeamRequestDto) => o.action === 'accept')
  @IsBoolean()
  allowSalonAgendaAccess!: boolean;

  /**
   * Permission 2 : Autoriser le salon lié à créer des RDV pour le tatoueur
   * Validé UNIQUEMENT si action === 'accept'
   * 
   * Persiste dans User.salonCanCreateAppointments après acceptation
   */
  @ValidateIf((o: RespondTeamRequestDto) => o.action === 'accept')
  @IsBoolean()
  allowSalonCreateAppointments!: boolean;
}
