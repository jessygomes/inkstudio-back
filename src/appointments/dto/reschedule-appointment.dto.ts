import { IsString, IsNotEmpty, IsDateString, IsOptional } from 'class-validator';

export class ProposeRescheduleDto {
  @IsNotEmpty({ message: 'L\'ID du rendez-vous est requis' })
  @IsString({ message: 'L\'ID du rendez-vous doit être une chaîne de caractères' })
  appointmentId: string;

  @IsOptional()
  @IsString({ message: 'Le message doit être une chaîne de caractères' })
  reason?: string; // Raison du changement

  @IsOptional()
  @IsString({ message: 'Le nouveau tatoueur doit être une chaîne de caractères' })
  newTatoueurId?: string; // Optionnel si on change de tatoueur
}

export class ClientRescheduleRequestDto {
  @IsNotEmpty({ message: 'Le token est requis' })
  @IsString({ message: 'Le token doit être une chaîne de caractères' })
  token: string;

  @IsNotEmpty({ message: 'L\'ID du rendez-vous est requis' })
  @IsString({ message: 'L\'ID du rendez-vous doit être une chaîne de caractères' })
  appointmentId: string;

  @IsNotEmpty({ message: 'La nouvelle date de début est requise' })
  @IsDateString({}, { message: 'La nouvelle date de début doit être au format ISO valide' })
  newStart: string;

  @IsNotEmpty({ message: 'La nouvelle date de fin est requise' })
  @IsDateString({}, { message: 'La nouvelle date de fin doit être au format ISO valide' })
  newEnd: string;

  @IsNotEmpty({ message: 'Le tatoueur est requis' })
  @IsString({ message: 'Le tatoueur doit être une chaîne de caractères' })
  tatoueurId: string;

  @IsOptional()
  @IsString({ message: 'Le message du client doit être une chaîne de caractères' })
  clientMessage?: string;
}
