import { renderMessageEmail, MessageEmailData } from '../../email/message-email';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { NotificationPreferenceService } from './notification-preference.service';
import { MailgunService } from '../../email/mailgun.service';
import { RedisRateLimiterService } from '../../redis/redis-rate-limiter.service';
import { User } from '@prisma/client';

@Injectable()
export class EmailNotificationService {
  private readonly logger = new Logger('EmailNotificationService');

  constructor(
    public readonly prisma: PrismaService,
    private readonly notificationPreferenceService: NotificationPreferenceService,
    private readonly mailgunService: MailgunService,
    private readonly redisRateLimiterService: RedisRateLimiterService,
  ) {}

  private isLocalhostUrl(value: string): boolean {
    try {
      const hasProtocol = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(value);
      const parsed = new URL(hasProtocol ? value : `https://${value}`);
      const host = parsed.hostname.toLowerCase();
      return host === 'localhost' || host === '127.0.0.1' || host === '::1';
    } catch {
      const lowered = value.toLowerCase();
      return lowered.includes('localhost') || lowered.includes('127.0.0.1') || lowered.includes('::1');
    }
  }

  private getFrontendBaseUrl(): string {
    const candidates = [process.env.FRONTEND_URL, process.env.WEB_URL, process.env.FRONT_URL]
      .map((url) => (url || '').trim())
      .filter((url) => url.length > 0)
      .map((url) => url.replace(/\/+$/, ''));

    if (candidates.length === 0) {
      return '#';
    }

    const isProduction = process.env.NODE_ENV === 'production';
    if (!isProduction) {
      return candidates[0];
    }

    return candidates.find((url) => !this.isLocalhostUrl(url)) || candidates[0];
  }

  private buildFrontendUrl(path: string): string {
    const baseUrl = this.getFrontendBaseUrl();
    if (baseUrl === '#') {
      return '#';
    }

    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${baseUrl}${normalizedPath}`;
  }

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
      conversationLink: this.buildFrontendUrl(`/conversations/${conversation.id}`),
      latestMessages: conversation.messages,
    });

    try {
      await this.mailgunService.sendEmail({
        from: `Inkera Studio <noreply@${process.env.MAILGUN_DOMAIN}>`,
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
      this.logger.error(`❌ Failed to send email for queueId ${queueId}: ${this.getErrorMessage(error)}`);
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
   * Construit le HTML d'email avec le template standard
   */
  private generateEmailHTML(data: MessageEmailData): string {
    return renderMessageEmail(data, this.buildFrontendUrl('/parametres'));
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
