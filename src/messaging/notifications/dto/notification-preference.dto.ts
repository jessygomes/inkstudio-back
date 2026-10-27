import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateNotificationPreferenceDto {
  @IsOptional()
  @IsBoolean()
  emailNotificationsEnabled?: boolean;

  @IsOptional()
  @IsString()
  @IsIn(['HOURLY', 'DAILY', 'NEVER'])
  emailFrequency?: string;
}

export class MuteConversationDto {
  @IsString()
  conversationId: string;
}

export class UnmuteConversationDto {
  @IsString()
  conversationId: string;
}

export class NotificationPreferenceResponseDto {
  id: string;
  userId: string;
  emailNotificationsEnabled: boolean;
  emailFrequency: string;
  mutedConversations: string[];
  createdAt: Date;
  updatedAt: Date;
}
