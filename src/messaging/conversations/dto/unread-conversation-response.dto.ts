import { MessageType } from '@prisma/client';

export class UnreadConversationResponseDto {
  conversationId: string;
  clientId: string;
  clientFirstName?: string;
  clientLastName?: string;
  clientImage?: string;
  lastMessage: {
    id: string;
    content: string;
    type: MessageType;
    createdAt: Date;
  };
  unreadCount: number;
  lastMessageAt: Date;
}
