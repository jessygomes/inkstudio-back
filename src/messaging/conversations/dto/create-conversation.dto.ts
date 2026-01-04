import { IsString, IsOptional, IsNotEmpty, MinLength } from 'class-validator';

export class CreateConversationDto {
  @IsString()
  @IsNotEmpty({ message: 'Le client est obligatoire' })
  clientUserId: string;

  @IsString()
  @IsOptional()
  appointmentId?: string;

  @IsString()
  @IsOptional()
  @MinLength(3, { message: 'Le sujet doit contenir au moins 3 caractères' })
  subject?: string;

  @IsString()
  @IsOptional()
  @MinLength(1, { message: 'Le message ne peut pas être vide' })
  firstMessage?: string;
}
