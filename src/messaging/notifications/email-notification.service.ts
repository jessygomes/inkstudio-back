import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { NotificationPreferenceService } from './notification-preference.service';
import { MailgunService } from '../../email/mailgun.service';
import { RedisRateLimiterService } from '../../redis/redis-rate-limiter.service';
import { Message, User } from '@prisma/client';

@Injectable()
export class EmailNotificationService {
  private readonly logger = new Logger('EmailNotificationService');

  constructor(
    public readonly prisma: PrismaService,
    private readonly notificationPreferenceService: NotificationPreferenceService,
    private readonly mailgunService: MailgunService,
    private readonly redisRateLimiterService: RedisRateLimiterService,
  ) {}

  /**
   * Vérifie si une notification doit être envoyée (hors-ligne, prefs, rate limit)
   */
  async shouldSendNotification(
    conversationId: string,
    recipientUserId: string,
  ): Promise<boolean> {
    const prefs = await this.notificationPreferenceService.getPreferences(
      recipientUserId,
    );

    if (!prefs.emailNotificationsEnabled) return false;
    if (prefs.mutedConversations.includes(conversationId)) return false;

    // Redis-based rate limiting (faster than database query)
    const canSend = await this.redisRateLimiterService.canSendEmail(
      conversationId,
      recipientUserId,
    );

    return canSend;
  }

  /**
   * Ajoute en file d'attente une notification email
   */
  async queueNotification(
    conversationId: string,
    recipientUserId: string,
  ): Promise<void> {
    const existing = await this.prisma.emailNotificationQueue.findFirst({
      where: {
        conversationId,
        recipientUserId,
        status: 'PENDING',
      },
    });

    if (existing) {
      await this.prisma.emailNotificationQueue.update({
        where: { id: existing.id },
        data: { messageCount: existing.messageCount + 1 },
      });
      return;
    }

    await this.prisma.emailNotificationQueue.create({
      data: {
        conversationId,
        recipientUserId,
        messageCount: 1,
      },
    });
  }

  /**
   * Envoie l'email et marque l'entrée comme SENT/FAILED
   */
  async sendNotification(queueId: string): Promise<void> {
    const queue = await this.prisma.emailNotificationQueue.findUnique({
      where: { id: queueId },
      include: {
        conversation: {
          include: {
            salon: true,
            clientUser: true,
            messages: {
              orderBy: { createdAt: 'desc' },
              take: 3,
            },
          },
        },
      },
    });

    if (!queue) return;

    const { conversation, recipientUserId, messageCount } = queue;
    const recipient: User | null =
      conversation.clientUserId === recipientUserId
        ? conversation.clientUser
        : conversation.salon;

    const sender: User | null =
      conversation.clientUserId === recipientUserId
        ? conversation.salon
        : conversation.clientUser;

    if (!recipient || !sender) {
      await this.prisma.emailNotificationQueue.update({
        where: { id: queueId },
        data: { status: 'FAILED', failureReason: 'Missing recipient or sender' },
      });
      return;
    }

    const subject =
      messageCount > 1
        ? `${messageCount} nouveaux messages de ${sender.salonName || sender.firstName}`
        : `Nouveau message de ${sender.salonName || sender.firstName}`;

    const html = this.generateEmailHTML({
      recipientName: recipient.firstName || 'Bonjour',
      senderName: sender.salonName || sender.firstName || 'Un contact',
      messageCount,
      conversationLink: `${process.env.FRONTEND_URL}/conversations/${conversation.id}`,
      latestMessages: conversation.messages,
    });

    try {
      await this.mailgunService.sendEmail({
        from: `Tattoo Studio <noreply@${process.env.MAILGUN_DOMAIN}>`,
        to: recipient.email,
        subject,
        html,
      });

      await this.prisma.emailNotificationQueue.update({
        where: { id: queueId },
        data: {
          status: 'SENT',
          sentAt: new Date(),
        },
      });

      // Record rate limit in Redis
      void this.redisRateLimiterService.recordEmailSent(
        conversation.id,
        recipientUserId,
        3600, // 1 hour
      );
    } catch (error: unknown) {
      await this.prisma.emailNotificationQueue.update({
        where: { id: queueId },
        data: {
          status: 'FAILED',
          failureReason: this.getErrorMessage(error),
        },
      });
    }
  }

  /**
   * Construit le HTML d'email
   */
  private generateEmailHTML(data: {
    recipientName: string;
    senderName: string;
    messageCount: number;
    conversationLink: string;
    latestMessages: Message[];
  }): string {
    const { recipientName, senderName, messageCount, conversationLink, latestMessages } = data;

    const messagesHtml = latestMessages
      .map(
        (msg) => `
          <div style="margin-bottom: 10px;">
            <strong>${senderName}:</strong>
            <p>${msg.content}</p>
            <small style="color: #999;">${new Date(msg.createdAt).toLocaleString('fr-FR')}</small>
          </div>
        `,
      )
      .join('');

    return `
      <html>
        <body style="font-family: Arial, sans-serif; color: #333;">
          <h2>Bonjour ${recipientName},</h2>
          <p>
            ${
              messageCount === 1
                ? `Vous avez reçu un nouveau message de ${senderName}`
                : `Vous avez reçu ${messageCount} nouveaux messages de ${senderName}`
            }
          </p>

          <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            ${messagesHtml}
          </div>

          <a href="${conversationLink}" 
             style="display: inline-block; padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 5px;">
            Voir la conversation
          </a>

          <hr style="margin-top: 30px; border: none; border-top: 1px solid #ddd;">
          <small style="color: #999;">
            <p>Vous recevez cet email parce que ${senderName} vous a envoyé un message.</p>
            <a href="${process.env.FRONTEND_URL}/settings/notifications">Gérer vos préférences de notification</a>
          </small>
        </body>
      </html>
    `;
  }

  /**
   * Normalise une erreur inconnue en message lisible
   */
  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return 'Erreur inconnue';
  }
}
