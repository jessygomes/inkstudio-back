import { IsOptional, IsString } from 'class-validator';

export class UpdateDrawingCardImageDto {
  @IsOptional()
  @IsString()
  caption?: string; // Nouvelle légende de la version du dessin
}
