import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

//! Schema de validation des données pour l'inscription d'un tatoueur (indépendant ou rattaché à un salon)

export class CreateTatoueurUserDto {
  @IsEmail({}, { message: 'Vous devez fournir une adresse email valide' })
  email: string;

  @IsString({ message: 'Vous devez fournir un prénom' })
  @IsNotEmpty({ message: 'Le prénom est requis' })
  firstName: string;

  @IsString({ message: 'Vous devez fournir un nom de famille' })
  @IsNotEmpty({ message: 'Le nom de famille est requis' })
  lastName: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsNotEmpty()
  @MinLength(6, {
    message: 'Le mot de passe doit contenir au moins 6 caractères',
  })
  password: string;

  // ID du salon auquel le tatoueur est rattaché (optionnel — null = indépendant)
  @IsOptional()
  @IsString()
  salonId?: string;

  // Honeypot invisible côté front: doit rester vide pour un humain.
  @IsOptional()
  @IsString()
  website?: string;
}
