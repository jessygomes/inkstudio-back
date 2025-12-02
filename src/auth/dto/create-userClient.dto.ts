import { IsEmail, IsNotEmpty, IsString, MinLength, IsOptional } from 'class-validator';

//! Schema de validation des données pour la création d'un utilisateur client

export class CreateUserClientDto {
  @IsEmail({}, { message: 'Vous devez fournir une adresse email valide' })
  @IsNotEmpty({ message: 'L\'email ne peut pas être vide' })
  email: string;

  @IsNotEmpty({ message: 'Le prénom est requis' })
  @IsString({ message: 'Le prénom doit être une chaîne de caractères' })
  firstName: string;

  @IsNotEmpty({ message: 'Le nom de famille est requis' })
  @IsString({ message: 'Le nom de famille doit être une chaîne de caractères' })
  lastName: string;

  @IsNotEmpty({ message: 'La date de naissance est requise' })
  @IsString({ message: 'La date de naissance doit être une chaîne de caractères' })
  birthDate: string;

  @IsNotEmpty({ message: 'Le mot de passe ne peut pas être vide' })
  @IsString({ message: 'Le mot de passe doit être une chaîne de caractères' })
  @MinLength(6, { message: 'Le mot de passe doit contenir au moins 6 caractères' })
  password: string;

  @IsOptional()
  @IsString()
  confirmPassword?: string;

  @IsOptional()
  acceptTerms?: boolean;
}
