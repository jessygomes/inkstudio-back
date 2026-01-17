import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import {
  ConversationResponseDto,
  ConversationParticipantDto,
  LastMessageDto,
} from './dto/conversation-response.dto';
import { PaginatedConversationsDto } from './dto/paginated-conversations.dto';
import { UnreadConversationResponseDto } from './dto/unread-conversation-response.dto';
import { ConversationStatus, MessageType } from '@prisma/client';
import { MessageNotificationService } from '../notifications/message-notification.service';

@Injectable()
export class ConversationsService {
  constructor(
    private prisma: PrismaService,
    private notificationService: MessageNotificationService,
  ) {}

  /**
   * Crée une nouvelle conversation entre un salon et un client
   */
  async createConversation(
    salonId: string,
    dto: CreateConversationDto,
  ): Promise<ConversationResponseDto> {
    // Vérifier que le client existe et a le bon rôle
    const client = await this.prisma.user.findUnique({
      where: { id: dto.clientUserId },
    });

    if (!client) {
      throw new NotFoundException('Client non trouvé');
    }

    if (client.role !== 'client') {
      throw new BadRequestException(
        'Cet utilisateur n\'est pas un client',
      );
    }

    // Vérifier que le salon existe
    const salon = await this.prisma.user.findUnique({
      where: { id: salonId },
    });

    if (!salon) {
      throw new NotFoundException('Salon non trouvé');
    }

    // Si appointmentId est fourni, vérifier qu'il existe
    if (dto.appointmentId) {
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: dto.appointmentId },
      });

      if (!appointment) {
        throw new NotFoundException('Rendez-vous non trouvé');
      }

      // Vérifier qu'une conversation n'existe pas déjà pour ce RDV
      const existingConversation = await this.prisma.conversation.findUnique({
        where: { appointmentId: dto.appointmentId },
        include: {
          salon: true,
          clientUser: true,
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });

      if (existingConversation) {
        // Retourner la conversation existante
        return this.mapToResponseDto(existingConversation, salonId);
      }
    }

    // Créer la conversation
    const conversation = await this.prisma.conversation.create({
      data: {
        salonId,
        clientUserId: dto.clientUserId,
        appointmentId: dto.appointmentId,
        subject: dto.subject,
        status: ConversationStatus.ACTIVE,
      },
      include: {
        salon: true,
        clientUser: true,
        appointment: true,
      },
    });

    // Si un premier message est fourni, le créer
    if (dto.firstMessage) {
      await this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderId: salonId,
          content: dto.firstMessage,
          type: MessageType.SYSTEM,
        },
      });

      // Incrémenter le compteur non lus pour le client
      await this.notificationService.incrementUnreadCount(
        conversation.id,
        dto.clientUserId,
      );
    }

    return this.mapToResponseDto(conversation, salonId);
  }

  /**
   * Récupère toutes les conversations d'un utilisateur (paginé)
   */
  async getConversations(
    userId: string,
    page: number = 1,
    limit: number = 20,
    status?: ConversationStatus,
  ): Promise<PaginatedConversationsDto> {
    const skip = (page - 1) * limit;

    const where = {
      OR: [{ salonId: userId }, { clientUserId: userId }],
      ...(status && { status }),
    };

    const [conversations, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where,
        include: {
          salon: true,
          clientUser: true,
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { lastMessageAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.conversation.count({ where }),
    ]);

    const data = await Promise.all(
      conversations.map((conv) => this.mapToResponseDto(conv, userId)),
    );

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Récupère les 10 premières conversations avec messages non lus par le salon uniquement
   * Retourne le dernier message et les infos du client
   */
  async getConversationsWithUnreadMessages(
    salonId: string,
  ): Promise<UnreadConversationResponseDto[]> {
    // Récupérer les conversations où le salon a des messages non lus envoyés par le client
    const conversationsWithUnread = await this.prisma.conversation.findMany({
      where: {
        salonId: salonId,
        status: ConversationStatus.ACTIVE,
        messages: {
          some: {
            senderId: { not: salonId }, // Messages envoyés par le client
            isRead: false,
          },
        },
      },
      include: {
        clientUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            image: true,
          },
        },
        messages: {
          where: {
            senderId: { not: salonId },
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            content: true,
            type: true,
            createdAt: true,
          },
        },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 10,
    });

    // Mapper les résultats
    const data = await Promise.all(
      conversationsWithUnread.map(async (conv) => {
        const unreadCount = await this.notificationService.getUnreadCount(
          conv.id,
          salonId,
        );

        const lastMessage = conv.messages[0];

        return {
          conversationId: conv.id,
          subject: conv.subject,
          clientId: conv.clientUser.id,
          clientFirstName: conv.clientUser.firstName ?? undefined,
          clientLastName: conv.clientUser.lastName ?? undefined,
          clientImage: conv.clientUser.image ?? undefined,
          lastMessage: {
            id: lastMessage.id,
            content: lastMessage.content,
            type: lastMessage.type,
            createdAt: lastMessage.createdAt,
          },
          unreadCount,
          lastMessageAt: conv.lastMessageAt,
        } as UnreadConversationResponseDto;
      }),
    );

    return data;
  }

  /**
   * Récupère une conversation par ID avec vérification des droits
   */
  async getConversationById(
    conversationId: string,
    userId: string,
  ): Promise<ConversationResponseDto> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        salon: true,
        clientUser: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation non trouvée');
    }

    // Vérifier les droits d'accès
    if (
      conversation.salonId !== userId &&
      conversation.clientUserId !== userId
    ) {
      throw new ForbiddenException(
        "Vous n'avez pas accès à cette conversation",
      );
    }

    // Marquer tous les messages non lus comme lus
    await this.markAllAsRead(conversationId, userId);

    return this.mapToResponseDto(conversation, userId);
  }

  /**
   * Met à jour une conversation (subject, status)
   */
  async updateConversation(
    conversationId: string,
    userId: string,
    dto: UpdateConversationDto,
  ): Promise<ConversationResponseDto> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation non trouvée');
    }

    // Vérifier les droits
    if (
      conversation.salonId !== userId &&
      conversation.clientUserId !== userId
    ) {
      throw new ForbiddenException(
        "Vous n'avez pas accès à cette conversation",
      );
    }

    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: dto,
      include: {
        salon: true,
        clientUser: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    return this.mapToResponseDto(updated, userId);
  }

  /**
   * Archive une conversation (seul le salon peut archiver)
   */
  async archiveConversation(
    conversationId: string,
    userId: string,
  ): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation non trouvée');
    }

    // Seul le salon peut archiver
    if (conversation.salonId !== userId) {
      throw new ForbiddenException(
        'Seul le salon peut archiver une conversation',
      );
    }

    const newStatus = conversation.status === ConversationStatus.ACTIVE
      ? ConversationStatus.ARCHIVED
      : ConversationStatus.ACTIVE;

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { status: newStatus },
    });
  }

  /**
   * Supprime une conversation (hard delete - seul le salon)
   */
  async deleteConversation(
    conversationId: string,
    userId: string,
  ): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation non trouvée');
    }

    // Seul le salon peut supprimer
    if (conversation.salonId !== userId) {
      throw new ForbiddenException(
        'Seul le salon peut supprimer une conversation',
      );
    }

    // Hard delete (cascade supprime messages, attachments, notifications)
    await this.prisma.conversation.delete({
      where: { id: conversationId },
    });
  }

  /**
   * Marque tous les messages d'une conversation comme lus
   */
  async markAllAsRead(conversationId: string, userId: string): Promise<void> {
    // Marquer tous les messages non lus comme lus
    await this.prisma.message.updateMany({
      where: {
        conversationId,
        senderId: { not: userId },
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    // Réinitialiser le compteur de notifications
    await this.notificationService.resetUnreadCount(conversationId, userId);
  }

  /**
   * Transforme une conversation Prisma en DTO de réponse
   */
  private async mapToResponseDto(
    conversation: {
      id: string;
      salonId: string;
      clientUserId: string;
      appointmentId: string | null;
      subject: string | null;
      status: ConversationStatus;
      createdAt: Date;
      updatedAt: Date;
      lastMessageAt: Date;
      salon: {
        id: string;
        email: string;
        firstName: string | null;
        lastName: string | null;
        salonName: string | null;
        image: string | null;
        role: string;
      };
      clientUser: {
        id: string;
        email: string;
        firstName: string | null;
        lastName: string | null;
        image: string | null;
        role: string;
      };
      messages?: Array<{
        id: string;
        content: string;
        senderId: string;
        type: MessageType;
        createdAt: Date;
      }>;
    },
    currentUserId: string,
  ): Promise<ConversationResponseDto> {
    // Mapper les participants
    const salon: ConversationParticipantDto = {
      id: conversation.salon.id,
      firstName: conversation.salon.firstName ?? undefined,
      lastName: conversation.salon.lastName ?? undefined,
      salonName: conversation.salon.salonName ?? undefined,
      image: conversation.salon.image ?? undefined,
      email: conversation.salon.email,
      role: conversation.salon.role,
    };

    const client: ConversationParticipantDto = {
      id: conversation.clientUser.id,
      firstName: conversation.clientUser.firstName ?? undefined,
      lastName: conversation.clientUser.lastName ?? undefined,
      salonName: undefined,
      image: conversation.clientUser.image ?? undefined,
      email: conversation.clientUser.email,
      role: conversation.clientUser.role,
    };

    // Mapper le dernier message
    let lastMessage: LastMessageDto | undefined;
    if (conversation.messages && conversation.messages.length > 0) {
      const msg = conversation.messages[0];
      lastMessage = {
        id: msg.id,
        content: msg.content,
        senderId: msg.senderId,
        type: msg.type,
        createdAt: msg.createdAt,
      };
    }

    // Récupérer le compteur de messages non lus
    const unreadCount = await this.notificationService.getUnreadCount(
      conversation.id,
      currentUserId,
    );

    return {
      id: conversation.id,
      salonId: conversation.salonId,
      clientUserId: conversation.clientUserId,
      appointmentId: conversation.appointmentId ?? undefined,
      subject: conversation.subject ?? undefined,
      status: conversation.status,
      salon,
      client,
      lastMessage,
      unreadCount,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      lastMessageAt: conversation.lastMessageAt,
    };
  }
}
