import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateNotificationPreferenceDto {
  @IsOptional()
  @IsBoolean()
  emailNotificationsEnabled?: boolean;

  @IsOptional()
  @IsString()
  emailFrequency?: string; // IMMEDIATE, HOURLY, DAILY, NEVER
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
