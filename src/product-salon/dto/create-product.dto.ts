/* eslint-disable prettier/prettier */
import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateProductDto {
  @IsString()
  userId: string; // ID de l'utilisateur qui crée le produit

  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description: string;

  @IsNumber()
  price: number;

  @IsString()
  @IsOptional()
  imageUrl: string;
}
