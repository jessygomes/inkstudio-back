import { IsOptional, IsString, IsUrl } from 'class-validator';

export class CreateDrawingCardImageDto {
  @IsUrl()
  url: string; // URL du fichier déjà envoyé dans le stockage

  @IsOptional()
  @IsString()
  caption?: string; // Commentaire associé à cette version
}
