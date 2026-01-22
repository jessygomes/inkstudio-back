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
    this.logger.log(`🔍 [Queue] Looking for existing PENDING email for conversation ${conversationId}, user ${recipientUserId}`);
    
    const existing = await this.prisma.emailNotificationQueue.findFirst({
      where: {
        conversationId,
        recipientUserId,
        status: 'PENDING',
      },
    });

    if (existing) {
      this.logger.log(`📈 [Queue] Found existing entry (id: ${existing.id}), incrementing count from ${existing.messageCount} to ${existing.messageCount + 1}`);
      await this.prisma.emailNotificationQueue.update({
        where: { id: existing.id },
        data: { messageCount: existing.messageCount + 1 },
      });
      this.logger.log(`✅ [Queue] Updated messageCount for entry ${existing.id}`);
      return;
    }

    this.logger.log(`📧 [Queue] No existing PENDING email found, creating new entry with messageCount=1`);
    const newEntry = await this.prisma.emailNotificationQueue.create({
      data: {
        conversationId,
        recipientUserId,
        messageCount: 1,
      },
    });
    this.logger.log(`✅ [Queue] Created new email queue entry: ${newEntry.id}`);
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
        from: `Inkera Studio <noreply@${process.env.MAILGUN_DOMAIN}>`,
        to: recipient.email,
        subject,
        html,
      });

      this.logger.log(`📤 Email sent to ${recipient.email} for conversation ${conversation.id}`);

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
          <div style="padding: 15px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.2);">
            <div style="color: rgba(255, 255, 255, 0.8); font-size: 12px; margin-bottom: 5px;">
              ${new Date(msg.createdAt).toLocaleString('fr-FR')}
            </div>
            <div style="color: #ffffff; font-size: 15px; line-height: 1.5;">
              ${msg.content}
            </div>
          </div>
        `,
      )
      .join('');

    const content = `
      <div class="content">
        <div class="greeting">
          Bonjour ${recipientName},
        </div>
        
        <div class="message">
          ${
            messageCount === 1
              ? `Vous avez reçu un nouveau message de <strong>${senderName}</strong>.`
              : `Vous avez reçu <strong>${messageCount} nouveaux messages</strong> de <strong>${senderName}</strong>.`
          }
        </div>

        <div class="details-card">
          <div class="details-title">
            💬 ${messageCount === 1 ? 'Dernier message' : 'Derniers messages'}
          </div>
          ${messagesHtml}
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${conversationLink}" class="cta-button" style="text-decoration: none;">
            📱 Voir la conversation
          </a>
        </div>

        <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 2px solid #f0f0f0;">
          <p style="font-size: 14px; color: #666; margin-bottom: 10px;">
            Vous recevez cet email car vous avez un nouveau message.
          </p>
          <a href="${process.env.FRONTEND_URL}/parametres" 
             style="color: #ff9d00; text-decoration: none; font-size: 14px; font-weight: 500;">
            ⚙️ Gérer vos préférences de notification
          </a>
        </div>
      </div>
    `;

    return this.getBaseTemplate(content, 'Nouveau message', senderName);
  }

  /**
   * Template de base avec le design cohérent du site
   */
  private getBaseTemplate(content: string, title: string = 'Inkera Studio', salonName: string = 'Inkera Studio'): string {
    return `
      <!DOCTYPE html>
      <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
        <link href="https://fonts.googleapis.com/css2?family=Didact+Gothic&family=Exo+2:wght@300;400;500;600;700&family=Montserrat+Alternates:wght@400;500;600;700&display=swap" rel="stylesheet">
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: 'Didact Gothic', sans-serif;
            background-color: #ffffff;
            color: #171717;
            line-height: 1.6;
            margin: 0;
            padding: 20px;
          }
          
          .email-container {
            max-width: 600px;
            margin: 0 auto;
            background: linear-gradient(135deg, #131313 0%, #1a1a1a 100%);
            border-radius: 20px;
            overflow: hidden;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
          }
          
          .header {
            background: linear-gradient(135deg, #131313 0%, #1a1a1a 100%);
            padding: 30px 40px;
            text-align: center;
            position: relative;
            font-family: 'Exo 2', sans-serif;
          }
          
          .header::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: linear-gradient(135deg, #131313 0%, #1a1a1a 100%);
            pointer-events: none;
          }
          
          .logo {
            font-family: 'Montserrat Alternates', sans-serif;
            font-size: 32px;
            font-weight: 700;
            color: #ffffff;
            margin-bottom: 8px;
            text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
          }
          
          .tagline {
            font-family: 'Didact Gothic', sans-serif;
            font-size: 14px;
            color: #ffffff;
            opacity: 0.9;
            text-transform: uppercase;
            letter-spacing: 2px;
          }
          
          .content {
            padding: 40px;
            background-color: #ffffff;
            color: #171717;
          }
          
          .greeting {
            font-family: 'Exo 2', sans-serif;
            font-size: 24px;
            font-weight: 600;
            color: #2d1f1a;
            margin-bottom: 20px;
          }
          
          .message {
            font-size: 16px;
            margin-bottom: 30px;
            color: #3e2c27;
            font-family: 'Exo 2', sans-serif;
          }
          
          .details-card {
            background: linear-gradient(135deg, #c79f8b, #af7e70);
            color: #fff;
            font-family: 'Exo 2', sans-serif;
            font-size: 16px;
            padding: 25px;
            border-radius: 15px;
            margin: 25px 0;
          }
          
          .details-title {
            font-family: 'Montserrat Alternates', sans-serif;
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 15px;
            color: #fff;
          }
          
          .cta-button {
            display: inline-block;
            background: linear-gradient(90deg, #ff9d00, #ff5500);
            color: #ffffff;
            text-decoration: none;
            padding: 15px 30px;
            border-radius: 25px;
            font-family: 'Exo 2', sans-serif;
            font-weight: 600;
            font-size: 16px;
            text-align: center;
            margin: 20px 0;
          }
          
          .footer {
            background: linear-gradient(135deg, #131313, #1a1a1a);
            padding: 30px 40px;
            text-align: center;
            color: #ffffff;
            font-family: 'Exo 2', sans-serif;
          }
          
          .footer-content {
            font-size: 14px;
            margin-bottom: 15px;
            opacity: 0.8;
          }
          
          @media (max-width: 600px) {
            .email-container {
              margin: 10px;
            }
            
            .header, .content, .footer {
              padding: 20px;
            }
            
            .logo {
              font-size: 24px;
            }
            
            .greeting {
              font-size: 20px;
            }
            
            .cta-button {
              width: 100%;
              padding: 12px 20px;
            }
          }
        </style>
      </head>
      <body>
        <div class="email-container">
          <div class="header">
            <div class="logo">${salonName}</div>
            <div class="tagline">Messagerie</div>
          </div>
          ${content}
          <div class="footer">
            <div class="footer-content">
              <p><strong>${salonName}</strong></p>
            </div>
          </div>
        </div>
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
