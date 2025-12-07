import { IsInt, IsString, IsOptional, IsArray, Min, Max } from 'class-validator';

export class CreateSalonReviewDto {
  @IsString()
  salonId: string;

  @IsString()
  @IsOptional()
  appointmentId?: string; // Optionnel mais recommandé pour vérifier

  @IsInt()
  @Min(1)
  @Max(5)
  rating: number; // Note de 1 à 5

  @IsString()
  @IsOptional()
  title?: string; // Titre de l'avis

  @IsString()
  @IsOptional()
  comment?: string; // Commentaire

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  photos?: string[]; // URLs des photos
}
