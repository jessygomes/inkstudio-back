/* eslint-disable prettier/prettier */
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateTatoueurDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  img: string;

  @IsString()
  description: string;

  @IsString()
  phone: string;

  @IsString()
  instagram: string;

  @IsString()
  @IsNotEmpty()
  userId: string; // ID du salon (utilisateur "admin")
}
