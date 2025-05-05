/* eslint-disable prettier/prettier */
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateTatoueurDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  img: string;

  @IsString()
  description: string;

  @IsString()
  @IsOptional()
  phone: string;

  @IsString()
  @IsOptional()
  hours: string;

  @IsString()
  @IsOptional()
  instagram: string;

  @IsString()
  @IsNotEmpty()
  userId: string; // ID du salon (utilisateur "admin")
}
