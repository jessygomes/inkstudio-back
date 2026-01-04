import { IsString, IsOptional, IsEnum } from 'class-validator';
import { ConversationStatus } from '@prisma/client';

export class UpdateConversationDto {
  @IsString()
  @IsOptional()
  subject?: string;

  @IsEnum(ConversationStatus)
  @IsOptional()
  status?: ConversationStatus;
}
