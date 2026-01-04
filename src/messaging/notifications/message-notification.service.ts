import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class MessageNotificationService {
  constructor(private prisma: PrismaService) {}

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

    return result._sum.unreadCount || 0;
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
