import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { DrawingCardStatus } from '@prisma/client';

export class UpdateDrawingCardDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string; // Nouveau titre de la card

  @IsOptional()
  @IsString()
  description?: string; // Description actualisée du projet

  @IsOptional()
  @IsString()
  additionalInfo?: string; // Informations ajoutées après échange avec le client

  @IsOptional()
  @IsEnum(DrawingCardStatus)
  status?: DrawingCardStatus; // Déplacement de la card dans le Kanban
}
