import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDrawingCardDto {
  @IsOptional()
  @IsString()
  sourceAppointmentId?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  clientUserId?: string;

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
