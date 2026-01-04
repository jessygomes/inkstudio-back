import { 
  IsString, 
  IsNotEmpty, 
  IsEnum, 
  IsArray, 
  IsOptional, 
  ValidateNested, 
  ArrayMaxSize, 
  IsNumber, 
  Max, 
  Matches,
  IsUrl,
  MinLength
} from 'class-validator';
import { Type } from 'class-transformer';
import { MessageType } from '@prisma/client';

export class MessageAttachmentDto {
  @IsString()
  @IsNotEmpty({ message: 'Le nom du fichier est obligatoire' })
  fileName: string;

  @IsString()
  @IsNotEmpty({ message: "L'URL du fichier est obligatoire" })
  @IsUrl({}, { message: "L'URL du fichier est invalide" })
  fileUrl: string;

  @IsString()
  @IsNotEmpty({ message: 'Le type de fichier est obligatoire' })
  @Matches(/^image\/(jpeg|jpg|png|gif|webp)$/, {
    message: 'Seules les images sont autorisées (jpg, png, gif, webp)',
  })
  fileType: string;

  @IsNumber()
  @Max(10485760, { message: 'Fichier trop volumineux (max 10MB)' })
  fileSize: number;

  @IsString()
  @IsOptional()
  uploadThingKey?: string;
}

export class CreateMessageDto {
  @IsString()
  @IsNotEmpty({ message: 'La conversation est obligatoire' })
  conversationId: string;

  @IsString()
  @IsNotEmpty({ message: 'Le contenu du message ne peut pas être vide' })
  @MinLength(1, { message: 'Le message doit contenir au moins 1 caractère' })
  content: string;

  @IsEnum(MessageType)
  @IsOptional()
  type?: MessageType = MessageType.TEXT;

  @IsArray()
  @ArrayMaxSize(5, { message: 'Maximum 5 fichiers par message' })
  @ValidateNested({ each: true })
  @Type(() => MessageAttachmentDto)
  @IsOptional()
  attachments?: MessageAttachmentDto[];
}
