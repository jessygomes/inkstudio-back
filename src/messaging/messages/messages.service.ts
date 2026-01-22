import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateMessageDto } from './dto/create-message.dto';
import {
  MessageResponseDto,
  MessageSenderDto,
  MessageAttachmentResponseDto,
} from './dto/message-response.dto';
import { PaginatedMessagesDto } from './dto/paginated-messages.dto';
import { MessageNotificationService } from '../notifications/message-notification.service';
import { MessageType } from '@prisma/client';

@Injectable()
export class MessagesService {
  constructor(
    private prisma: PrismaService,
    private notificationService: MessageNotificationService,
  ) {}

  /**
   * Envoie un nouveau message dans une conversation
   */
  async sendMessage(
    userId: string,
    dto: CreateMessageDto,
  ): Promise<MessageResponseDto> {
    // Vérifier que la conversation existe
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: dto.conversationId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation non trouvée');
    }

    // Vérifier que l'utilisateur est participant
    if (
      conversation.salonId !== userId &&
      conversation.clientUserId !== userId
    ) {
      throw new ForbiddenException(
        "Vous n'avez pas accès à cette conversation",
      );
    }

    // Créer le message avec les pièces jointes
    const message = await this.prisma.message.create({
      data: {
        conversationId: dto.conversationId,
        senderId: userId,
        content: dto.content,
        type: dto.type,
        attachments: dto.attachments
          ? {
              create: dto.attachments.map((att) => ({
                fileName: att.fileName,
                fileUrl: att.fileUrl,
                fileType: att.fileType,
                fileSize: att.fileSize,
                uploadThingKey: att.uploadThingKey,
              })),
            }
          : undefined,
      },
      include: {
        sender: true,
        attachments: true,
      },
    });

    // Mettre à jour lastMessageAt de la conversation
    await this.prisma.conversation.update({
      where: { id: dto.conversationId },
      data: { lastMessageAt: new Date() },
    });

    // Incrémenter le compteur de non lus pour le destinataire
    const recipientId =
      conversation.salonId === userId
        ? conversation.clientUserId
        : conversation.salonId;

    await this.notificationService.incrementUnreadCount(
      dto.conversationId,
      recipientId,
    );

    return this.mapToResponseDto(message);
  }

  /**
   * Récupère les messages d'une conversation (paginé, ordre anti-chronologique)
   */
  async getMessages(
    conversationId: string,
    userId: string,
    page: number = 1,
    limit: number = 50,
  ): Promise<PaginatedMessagesDto> {
    // Vérifier que l'utilisateur a accès à la conversation
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation non trouvée');
    }

    if (
      conversation.salonId !== userId &&
      conversation.clientUserId !== userId
    ) {
      throw new ForbiddenException(
        "Vous n'avez pas accès à cette conversation",
      );
    }

    const skip = (page - 1) * limit;

    const [messages, total] = await Promise.all([
      this.prisma.message.findMany({
        where: { conversationId },
        include: {
          sender: true,
          attachments: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.message.count({ where: { conversationId } }),
    ]);

    // Marquer les messages non lus comme lus
    const unreadMessageIds = messages
      .filter((msg) => !msg.isRead && msg.senderId !== userId)
      .map((msg) => msg.id);

    if (unreadMessageIds.length > 0) {
      await this.prisma.message.updateMany({
        where: { id: { in: unreadMessageIds } },
        data: { isRead: true, readAt: new Date() },
      });

      // Décrémenter le compteur de notifications
      await this.notificationService.resetUnreadCount(conversationId, userId);

      // Annuler les emails en attente si l'utilisateur a lu les messages
      await this.prisma.emailNotificationQueue.deleteMany({
        where: {
          conversationId,
          recipientUserId: userId,
          status: 'PENDING',
        },
      });
    }

    const data = messages.map((msg) => this.mapToResponseDto(msg));

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasMore: skip + messages.length < total,
    };
  }

  /**
   * Marque un message comme lu
   */
  async markAsRead(
    messageId: string,
    userId: string,
  ): Promise<MessageResponseDto> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: {
        conversation: true,
        sender: true,
        attachments: true,
      },
    });

    if (!message) {
      throw new NotFoundException('Message non trouvé');
    }

    // Vérifier que l'utilisateur a accès
    if (
      message.conversation.salonId !== userId &&
      message.conversation.clientUserId !== userId
    ) {
      throw new ForbiddenException("Vous n'avez pas accès à ce message");
    }

    // Ne marquer comme lu que si l'utilisateur n'est pas l'expéditeur
    if (message.senderId !== userId && !message.isRead) {
      const updated = await this.prisma.message.update({
        where: { id: messageId },
        data: {
          isRead: true,
          readAt: new Date(),
        },
        include: {
          sender: true,
          attachments: true,
        },
      });

      return this.mapToResponseDto(updated);
    }

    return this.mapToResponseDto(message);
  }

  /**
   * Supprime un message (hard delete - seul l'auteur)
   */
  async deleteMessage(messageId: string, userId: string): Promise<void> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { conversation: true },
    });

    if (!message) {
      throw new NotFoundException('Message non trouvé');
    }

    // Seul l'auteur peut supprimer son message
    if (message.senderId !== userId) {
      throw new ForbiddenException(
        'Vous ne pouvez supprimer que vos propres messages',
      );
    }

    // Hard delete (cascade supprime les attachments)
    await this.prisma.message.delete({
      where: { id: messageId },
    });
  }

  /**
   * Transforme un message Prisma en DTO de réponse
   */
  private mapToResponseDto(message: {
    id: string;
    conversationId: string;
    content: string;
    type: MessageType;
    isRead: boolean;
    readAt: Date | null;
    createdAt: Date;
    sender: {
      id: string;
      firstName: string | null;
      lastName: string | null;
      salonName: string | null;
      image: string | null;
      role: string;
    };
    attachments?: Array<{
      id: string;
      fileName: string;
      fileUrl: string;
      fileType: string;
      fileSize: number;
    }>;
  }): MessageResponseDto {
    const sender: MessageSenderDto = {
      id: message.sender.id,
      firstName: message.sender.firstName ?? undefined,
      lastName: message.sender.lastName ?? undefined,
      salonName: message.sender.salonName ?? undefined,
      image: message.sender.image ?? undefined,
      role: message.sender.role,
    };

    const attachments: MessageAttachmentResponseDto[] | undefined =
      message.attachments?.map((att) => ({
        id: att.id,
        fileName: att.fileName,
        fileUrl: att.fileUrl,
        fileType: att.fileType,
        fileSize: att.fileSize,
      }));

    return {
      id: message.id,
      conversationId: message.conversationId,
      content: message.content,
      type: message.type,
      isRead: message.isRead,
      readAt: message.readAt ?? undefined,
      createdAt: message.createdAt,
      sender,
      attachments,
    };
  }
}
