import { IsArray, IsOptional, IsString } from 'class-validator';

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
}
