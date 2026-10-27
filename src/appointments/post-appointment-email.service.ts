import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { ReminderDeliveryService } from 'src/follow-up/reminder-delivery.service';

export interface SendResult { sent7Days: number; sent30Days: number }

@Injectable()
export class PostAppointmentEmailService {
  private readonly logger = new Logger(PostAppointmentEmailService.name);
  constructor(private readonly prisma: PrismaService, private readonly delivery: ReminderDeliveryService) {}

  async sendDueEmails(): Promise<SendResult> {
    // Filter by each professional's delays in SQL before taking a batch, so future reminders cannot starve due ones.
    const appointments = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT a."id" FROM "Appointment" a
      JOIN "User" u ON u."id" = COALESCE(a."performerUserId", a."userId")
      WHERE a."status" = 'COMPLETED' AND a."prestation" IN ('TATTOO', 'PIERCING', 'RETOUCHE')
        AND ((a."followUp7SentAt" IS NULL AND COALESCE(a."completedAt", a."end") + u."followUpEmailDelayDays" * INTERVAL '1 day' <= NOW())
          OR (a."prestation" = 'TATTOO' AND a."followUp30SentAt" IS NULL AND COALESCE(a."completedAt", a."end") + u."retouchEmailDelayDays" * INTERVAL '1 day' <= NOW()))
      ORDER BY COALESCE(a."completedAt", a."end") ASC, a."id" ASC LIMIT 200`;
    const result = { sent7Days: 0, sent30Days: 0 };
    for (const appointment of appointments) {
      for (const kind of ['FOLLOW_UP', 'RETOUCH'] as const) {
        try {
          if (await this.delivery.deliver(appointment.id, kind)) result[kind === 'FOLLOW_UP' ? 'sent7Days' : 'sent30Days']++;
        } catch (error) { this.logger.error(`Rappel ${kind} ${appointment.id} : ${String(error)}`); }
      }
    }
    return result;
  }
}
