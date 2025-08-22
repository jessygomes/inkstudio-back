import { IsOptional, IsString } from 'class-validator';

export class AddPhotoDto {
  @IsString()
  title: string; // Titre de la photo

  @IsString()
  imageUrl: string; // URL de l'image de la photo

  @IsOptional()
  @IsString()
  description: string; // Description optionnelle de la photo

  @IsOptional()
  @IsString()
  tatoueurId: string; // ID du tatoueur qui a réalisé le tatouage, si applicable
}
