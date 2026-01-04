import { Process, Processor } from '@nestjs/bull';
import { EmailNotificationService } from '../notifications/email-notification.service';

@Processor('email-notifications')
export class SendEmailNotificationsJob {
  constructor(private readonly emailNotificationService: EmailNotificationService) {}

  @Process('send-queued')
  async sendQueued(): Promise<{ sent: number }> {
    const pendingEmails = await this.emailNotificationService.prisma.emailNotificationQueue.findMany({
      where: { status: 'PENDING' },
      select: { id: true },
    });

    let sent = 0;
    for (const email of pendingEmails) {
      await this.emailNotificationService.sendNotification(email.id);
      sent += 1;
    }

    return { sent };
  }
}
