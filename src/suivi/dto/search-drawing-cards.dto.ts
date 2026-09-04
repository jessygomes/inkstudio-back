import { IsDateString, IsOptional, IsString } from 'class-validator';
import { DrawingCardStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class SearchDrawingCardsDto {
  @IsOptional()
  @IsEnum(DrawingCardStatus)
  status?: DrawingCardStatus; // Colonne Kanban recherchée

  @IsOptional()
  @IsString()
  search?: string; // Recherche sur le titre ou le nom du client

  @IsOptional()
  @IsString()
  tatoueurId?: string; // ID d'un tatoueur interne ou d'un user_tatoueur

  @IsOptional()
  @IsDateString()
  appointmentDateFrom?: string; // Début de la période du RDV source

  @IsOptional()
  @IsDateString()
  appointmentDateTo?: string; // Fin de la période du RDV source
}
