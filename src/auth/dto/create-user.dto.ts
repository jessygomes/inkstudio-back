import { SaasPlan } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { CHECKOUT_PLANS, CheckoutPlan } from 'src/stripe/stripe.constants';

//! Schema de validation des données pour la création d'un utilisateur

export class CreateUserDto {
  @IsEmail({}, { message: 'Vous devez fournir une adresse email valide' })
  email: string;

  // Détermine si c'est un salon ou un tatoueur indépendant
  @IsIn(['user_salon', 'user_tatoueur'], {
    message: "Le rôle doit être 'user_salon' ou 'user_tatoueur'",
  })
  role: 'user_salon' | 'user_tatoueur';

  // Requis uniquement pour user_salon
  @IsOptional()
  @IsString({ message: 'Vous devez fournir un nom de salon' })
  salonName?: string;

  @IsString({ message: 'Vous devez fournir un prénom' })
  @IsNotEmpty({ message: 'Le prénom est requis' })
  firstName: string;

  @IsString({ message: 'Vous devez fournir un nom de famille' })
  @IsNotEmpty({ message: 'Le nom de famille est requis' })
  lastName: string;

  @IsString()
  phone: string;

  // Requis uniquement pour user_salon (plan SaaS)
  @IsOptional()
  @IsEnum(SaasPlan, { message: 'Vous devez fournir un plan SaaS valide' })
  saasPlan?: SaasPlan;

  @IsOptional()
  @IsIn(CHECKOUT_PLANS, {
    message: 'Vous devez fournir un plan de checkout valide',
  })
  checkoutPlan?: CheckoutPlan;

  @IsNotEmpty()
  @MinLength(6, {
    message: 'Le mot de passe doit contenir au moins 6 caractères',
  })
  password: string;

  // Honeypot invisible côté front: doit rester vide pour un humain.
  @IsOptional()
  @IsString()
  website?: string;
}
