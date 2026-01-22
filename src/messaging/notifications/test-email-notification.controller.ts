import { Controller, Post, UseGuards, Logger } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { EmailNotificationService } from './email-notification.service';
import { PrismaService } from '../../database/prisma.service';

/**
 * Contrôleur temporaire pour tester manuellement l'envoi des notifications email
 * À SUPPRIMER EN PRODUCTION
 */
@Controller('test/email-notifications')
@UseGuards(JwtAuthGuard)
export class TestEmailNotificationController {
  private readonly logger = new Logger('TestEmailNotificationController');

  constructor(
    private readonly emailNotificationService: EmailNotificationService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * POST /test/email-notifications/send-pending
   * Force l'envoi de tous les emails en attente (pour debug)
   */
  @Post('send-pending')
  async sendPendingEmails(): Promise<{ sent: number; pending: any[] }> {
    this.logger.warn('🔍 Manual trigger: sending all pending email notifications');

    const pendingEmails = await this.prisma.emailNotificationQueue.findMany({
      where: { status: 'PENDING' },
      include: {
        conversation: {
          include: {
            salon: { select: { email: true, salonName: true } },
            clientUser: { select: { email: true, firstName: true } },
          },
        },
      },
    });

    this.logger.log(`Found ${pendingEmails.length} pending emails to send`);

    let sent = 0;
    for (const email of pendingEmails) {
      try {
        await this.emailNotificationService.sendNotification(email.id);
        sent++;
        this.logger.log(`✅ Sent email notification ${email.id}`);
      } catch (error) {
        this.logger.error(
          `❌ Failed to send email ${email.id}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    return {
      sent,
      pending: pendingEmails.map((e) => ({
        id: e.id,
        conversationId: e.conversationId,
        recipientUserId: e.recipientUserId,
        messageCount: e.messageCount,
        createdAt: e.createdAt,
      })),
    };
  }
}
