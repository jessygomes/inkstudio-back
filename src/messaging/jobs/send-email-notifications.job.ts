import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { EmailNotificationService } from '../notifications/email-notification.service';

@Processor('email-notifications')
export class SendEmailNotificationsJob {
  private readonly logger = new Logger('SendEmailNotificationsJob');

  constructor(private readonly emailNotificationService: EmailNotificationService) {}

  @Process('send-queued')
  async sendQueued(): Promise<{ sent: number }> {
    try {
      const pendingEmails = await this.emailNotificationService.prisma.emailNotificationQueue.findMany({
        where: { status: 'PENDING' },
        select: { id: true },
      });

      this.logger.log(`🚚 Processing queued emails: ${pendingEmails.length}`);

      if (pendingEmails.length === 0) {
        this.logger.log('ℹ️ No pending emails to process');
        return { sent: 0 };
      }

      let sent = 0;
      for (const email of pendingEmails) {
        await this.emailNotificationService.sendNotification(email.id);
        sent += 1;
      }

      this.logger.log(`✅ Queued emails processed: ${sent}`);
      return { sent };
    } catch (error: unknown) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      this.logger.error(`❌ Failed processing queued emails: ${error instanceof Error ? error.message : error}`);
      return { sent: 0 };
    }
  }
}
