import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';
import { PieceSize } from '@prisma/client';

export class AddPhotoDto {
  @IsString()
  title: string; // Titre de la photo

  @IsString()
  imageUrl: string; // URL de l'image de la photo

  @IsOptional()
  @IsString()
  description?: string; // Description optionnelle de la photo

  @IsOptional()
  @IsString()
  tatoueurId?: string; // ID du tatoueur qui a réalisé le tatouage, si applicable

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  style?: string[]; // Styles associés à l'image portfolio

  @IsOptional()
  @IsEnum(PieceSize)
  pieceSize?: PieceSize; // Taille de la pièce (petite, moyenne, grosse)

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categoryIds?: string[]; // Catégories de tatouage (walk-ins, patchwork, touriste...)

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  hashtags?: string[];
}
