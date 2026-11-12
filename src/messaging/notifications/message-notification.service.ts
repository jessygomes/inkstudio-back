import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';

/** Nombres de messages non lus (par conversation) qui déclenchent une notification dans le centre. */
const UNREAD_THRESHOLDS = [5, 10, 20];

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
    const row = await this.prisma.messageNotification.upsert({
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
    void this.notifyRecipient(conversationId, userId, row?.unreadCount ?? 1);
  }

  /**
   * Chaque message reçu part en push seulement (pas d'entrée dans le centre de notifications, pour ne pas le saturer).
   * Le centre reçoit une entrée quand le nombre de messages non lus de la conversation atteint un seuil (5, 10, 20).
   */
  private async notifyRecipient(conversationId: string, userId: string, unreadCount: number): Promise<void> {
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
      await this.appNotifications.notify({ userId, type: 'message.new', title: name, body: preview, data: { conversationId }, only: 'push' });
      if (UNREAD_THRESHOLDS.includes(unreadCount)) {
        await this.appNotifications.notify({
          userId,
          type: 'message.unread_threshold',
          title: name,
          body: unreadCount >= 20 ? '20 messages non lus ou plus' : `${unreadCount} messages non lus`,
          data: { conversationId, count: unreadCount },
          only: 'inApp',
        });
      }
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
