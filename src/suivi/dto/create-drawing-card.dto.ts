import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDrawingCardDto {
  @IsString()
  sourceAppointmentId: string; // RDV Projet ou RDV créé par le tatoueur à l'origine de la card

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string; // Titre personnalisé, sinon celui du RDV est repris

  @IsOptional()
  @IsString()
  description?: string; // Description personnalisée du projet

  @IsOptional()
  @IsString()
  additionalInfo?: string; // Notes initiales complémentaires
}
