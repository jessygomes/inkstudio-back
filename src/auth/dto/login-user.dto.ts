/* eslint-disable prettier/prettier */
import { IsEmail, IsNotEmpty } from 'class-validator';

//! Schema de validation des données pour la création d'un utilisateur

export class LoginUserDto {
  @IsEmail({}, { message: 'Vous devez fournir une adresse email valide' })
  email: string;

  @IsNotEmpty()
  password: string;
}
