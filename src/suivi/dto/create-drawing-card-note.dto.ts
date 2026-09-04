import { DrawingCardNoteType } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class CreateDrawingCardNoteDto {
  @IsString()
  content: string; // Trace écrite de la note ou de l'échange

  @IsOptional()
  @IsEnum(DrawingCardNoteType)
  type?: DrawingCardNoteType; // Permet de distinguer note interne et échange client
}
