import { ConversationStatus, MessageType } from '@prisma/client';

export class ConversationParticipantDto {
  id: string;
  firstName?: string;
  lastName?: string;
  salonName?: string;
  image?: string;
  email: string;
  role: string;
}

export class LastMessageDto {
  id: string;
  content: string;
  senderId: string;
  type: MessageType;
  createdAt: Date;
}

export class ConversationResponseDto {
  id: string;
  salonId: string;
  clientUserId: string;
  appointmentId?: string;
  subject?: string;
  status: ConversationStatus;
  
  salon: ConversationParticipantDto;
  client: ConversationParticipantDto;
  
  lastMessage?: LastMessageDto;
  unreadCount: number;
  
  createdAt: Date;
  updatedAt: Date;
  lastMessageAt: Date;
}
