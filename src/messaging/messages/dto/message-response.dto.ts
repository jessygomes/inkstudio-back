import { MessageType } from '@prisma/client';

export class MessageSenderDto {
  id: string;
  firstName?: string;
  lastName?: string;
  salonName?: string;
  image?: string;
  role: string;
}

export class MessageAttachmentResponseDto {
  id: string;
  fileName: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
}

export class MessageResponseDto {
  id: string;
  conversationId: string;
  content: string;
  type: MessageType;
  isRead: boolean;
  readAt?: Date;
  createdAt: Date;
  
  sender: MessageSenderDto;
  attachments?: MessageAttachmentResponseDto[];
}
