/**
 * Types et interfaces pour les événements WebSocket de messagerie
 */

export interface CreateMessagePayload {
  conversationId: string;
  content: string;
  attachments?: Array<{
    fileName: string,
    fileUrl: string,
    fileType: string,
    fileSize: number,
    uploadThingKey?: string,
  }>;
}

export interface MarkAsReadPayload {
  messageId: string;
}

export interface MarkConversationAsReadPayload {
  conversationId: string;
}

export interface JoinConversationPayload {
  conversationId: string;
}

export interface LeaveConversationPayload {
  conversationId: string;
}

export interface UserTypingPayload {
  conversationId: string;
}

export interface UserStoppedTypingPayload {
  conversationId: string;
}

// Événements serveur vers client
export interface NewMessageEvent {
  id: string;
  conversationId: string;
  content: string;
  type: string;
  isRead: boolean;
  createdAt: Date;
  sender: {
    id: string,
    firstName?: string,
    lastName?: string,
    salonName?: string,
    image?: string,
    role: string,
  };
  attachments?: Array<{
    id: string,
    fileName: string,
    fileUrl: string,
    fileType: string,
    fileSize: number,
  }>;
}

export interface MessageReadEvent {
  messageId: string;
  readAt: Date;
}

export interface UserTypingEvent {
  conversationId: string;
  userId: string;
  userName: string;
}

export interface UserStoppedTypingEvent {
  conversationId: string;
  userId: string;
}

export interface UserOnlineEvent {
  userId: string;
  userName: string;
}

export interface UserOfflineEvent {
  userId: string;
}

export interface UnreadCountUpdatedEvent {
  totalUnread: number;
}

export interface ConversationCreatedEvent {
  id: string;
  salonId: string;
  clientUserId: string;
  subject?: string;
  createdAt: Date;
}
