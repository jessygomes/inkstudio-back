import { IsString, IsOptional, IsNotEmpty, IsDateString } from 'class-validator';

export class CreateBlockedSlotDto {
  @IsNotEmpty({ message: 'La date de début est requise' })
  @IsDateString({}, { message: 'La date de début doit être au format ISO valide' })
  startDate: string; // Format ISO string

  @IsNotEmpty({ message: 'La date de fin est requise' })
  @IsDateString({}, { message: 'La date de fin doit être au format ISO valide' })
  endDate: string;   // Format ISO string

  @IsOptional()
  @IsString({ message: 'La raison doit être une chaîne de caractères' })
  reason?: string;

  @IsOptional()
  @IsString({ message: 'L\'ID du tatoueur doit être une chaîne de caractères' })
  tatoueurId?: string; // Si null/undefined, bloque pour tous les tatoueurs

  @IsNotEmpty({ message: 'L\'ID de l\'utilisateur est requis' })
  @IsString({ message: 'L\'ID de l\'utilisateur doit être une chaîne de caractères' })
  userId: string; // Salon propriétaire
}
