import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';

@Injectable()
export class MessageNotificationService {
  constructor(
    private prisma: PrismaService,
    @Optional() private readonly appNotifications?: NotificationsService,
  ) {}

  /**
   * Incrémente le compteur de messages non lus pour un utilisateur dans une conversation
   */
  async incrementUnreadCount(
    conversationId: string,
    userId: string,
  ): Promise<void> {
    await this.prisma.messageNotification.upsert({
      where: {
        conversationId_userId: {
          conversationId,
          userId,
        },
      },
      update: {
        unreadCount: {
          increment: 1,
        },
        lastUnreadAt: new Date(),
      },
      create: {
        conversationId,
        userId,
        unreadCount: 1,
        lastUnreadAt: new Date(),
      },
    });
    void this.notifyRecipient(conversationId, userId);
  }

  /** Centre de notifications : un message de plus, regroupé par conversation tant qu'il n'est pas lu. */
  private async notifyRecipient(conversationId: string, userId: string): Promise<void> {
    if (!this.appNotifications) return;
    try {
      const last = await this.prisma.message.findFirst({
        where: { conversationId, NOT: { senderId: userId } },
        orderBy: { createdAt: 'desc' },
        select: {
          content: true,
          type: true,
          attachments: { select: { id: true }, take: 1 },
          sender: { select: { firstName: true, lastName: true, salonName: true, role: true } },
        },
      });
      if (!last) return;
      const s = last.sender;
      const name = (s?.role === 'client' ? [s.firstName, s.lastName].filter(Boolean).join(' ') : s?.salonName || [s?.firstName, s?.lastName].filter(Boolean).join(' ')) || 'Nouveau message';
      const preview = last.content?.trim() ? last.content.trim().slice(0, 140) : last.attachments.length ? '📷 Photo' : 'Nouveau message';
      await this.appNotifications.notifyGrouped(
        { userId, type: 'message.new', title: name, body: preview, data: { conversationId } },
        'conversationId',
        (count, latest) => (count > 1 ? `${count} nouveaux messages · ${latest}` : latest),
        preview,
      );
    } catch {
      // Une notification ratée ne doit jamais bloquer l'envoi du message.
    }
  }

  /**
   * Réinitialise le compteur de messages non lus pour un utilisateur dans une conversation
   */
  async resetUnreadCount(
    conversationId: string,
    userId: string,
  ): Promise<void> {
    await this.prisma.messageNotification.upsert({
      where: {
        conversationId_userId: {
          conversationId,
          userId,
        },
      },
      update: {
        unreadCount: 0,
        lastUnreadAt: null,
      },
      create: {
        conversationId,
        userId,
        unreadCount: 0,
        lastUnreadAt: null,
      },
    });
  }

  /**
   * Récupère le nombre total de messages non lus pour un utilisateur (toutes conversations)
   */
  async getTotalUnreadCount(userId: string): Promise<number> {
    const result = await this.prisma.messageNotification.aggregate({
      where: {
        userId,
      },
      _sum: {
        unreadCount: true,
      },
    });

    // Project requests are visible before any conversation exists.
    const pendingRequests = await this.prisma.projectProposal.count({
      where: { clientUserId: userId, status: 'PENDING' },
    });
    return (result._sum.unreadCount || 0) + pendingRequests;
  }

  /**
   * Récupère le compteur de messages non lus pour une conversation spécifique
   */
  async getUnreadCount(
    conversationId: string,
    userId: string,
  ): Promise<number> {
    const notification = await this.prisma.messageNotification.findUnique({
      where: {
        conversationId_userId: {
          conversationId,
          userId,
        },
      },
    });

    return notification?.unreadCount || 0;
  }
}
