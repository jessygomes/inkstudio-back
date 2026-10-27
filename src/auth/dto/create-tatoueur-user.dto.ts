import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  MaxLength,
} from 'class-validator';

//! Schema de validation des données pour l'inscription d'un tatoueur (indépendant ou rattaché à un salon)

export class CreateTatoueurUserDto {
  @IsEmail({}, { message: 'Vous devez fournir une adresse email valide' })
  email: string;

  @IsString({ message: 'Vous devez fournir un prénom' })
  @IsNotEmpty({ message: 'Le prénom est requis' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  firstName: string;

  @IsString({ message: 'Vous devez fournir un nom de famille' })
  @IsNotEmpty({ message: 'Le nom de famille est requis' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  lastName: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  nickname?: string;

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
