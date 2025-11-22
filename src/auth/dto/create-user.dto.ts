import { SaasPlan } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsString,
  MinLength,
} from 'class-validator';

//! Schema de validation des données pour la création d'un utilisateur

export class CreateUserDto {
  @IsEmail({}, { message: 'Vous devez fournir une adresse email valide' })
  email: string;

  @IsString({ message: 'Vous devez fournir un nom de salon' })
  @IsNotEmpty({ message: 'Le nom du salon est requis' })
  salonName: string;

  @IsString({ message: 'Vous devez fournir un prénom' })
  @IsNotEmpty({ message: 'Le prénom est requis' })
  firstName: string;

  @IsString({ message: 'Vous devez fournir un nom de famille' })
  @IsNotEmpty({ message: 'Le nom de famille est requis' })
  lastName: string;

  @IsString()
  phone: string;

  @IsEnum(SaasPlan, { message: 'Vous devez fournir un plan SaaS valide' })
  saasPlan: SaasPlan;

  @IsNotEmpty()
  @MinLength(6, {
    message: 'Le mot de passe doit contenir au moins 6 caractères',
  })
  password: string;
}
