import { Process, Processor, OnQueueActive, OnQueueCompleted, OnQueueFailed } from '@nestjs/bull';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job } from 'bull';
import { EmailNotificationService } from '../notifications/email-notification.service';

@Processor('email-notifications')
export class SendEmailNotificationsJob implements OnModuleInit {
  private readonly logger = new Logger('SendEmailNotificationsJob');

  constructor(private readonly emailNotificationService: EmailNotificationService) {}

  onModuleInit() {}

  @OnQueueActive()
  onActive() {}

  @OnQueueCompleted()
  onCompleted() {}

  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    this.logger.error(`❌ Job ${job.id} failed - Error: ${error.message}`);
  }

  @Process('send-queued')
  async sendQueued(): Promise<{ sent: number }> {
    try {
      const pendingEmails = await this.emailNotificationService.prisma.emailNotificationQueue.findMany({
        where: { status: 'PENDING' },
        select: { id: true },
      });

      this.logger.log(`🚚 Processing queued emails: ${pendingEmails.length}`);

      if (pendingEmails.length === 0) {
        return { sent: 0 };
      }

      let sent = 0;
      for (const email of pendingEmails) {
        await this.emailNotificationService.sendNotification(email.id);
        sent += 1;
      }

      return { sent };
    } catch (error: unknown) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      this.logger.error(`❌ Failed processing queued emails: ${error instanceof Error ? error.message : error}`);
      return { sent: 0 };
    }
  }
}
