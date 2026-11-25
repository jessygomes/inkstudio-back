import { ConversationStatus, MessageType } from '@prisma/client';

export class ConversationParticipantDto {
  id: string;
  firstName?: string;
  lastName?: string;
  salonName?: string;
  image?: string;
  city?: string;
  postalCode?: string;
  address?: string;
  email: string;
  role: string;
  /** Pseudo du client (conversation ouverte après un favori). */
  pseudo?: string;
}

export class LastMessageDto {
  id: string;
  content: string;
  senderId: string;
  type: MessageType;
  createdAt: Date;
}

export class ConversationResponseDto {
  projectContactPending?: boolean;
  /**
   * Accès du professionnel aux informations du client : null = normal ; HIDDEN / REQUESTED / DECLINED = pseudo seulement ;
   * GRANTED = le client a accepté de partager ses informations.
   */
  clientAccess?: 'HIDDEN' | 'REQUESTED' | 'GRANTED' | 'DECLINED' | null;
  clientAlias?: string;
  contactBlocked?: boolean;
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
