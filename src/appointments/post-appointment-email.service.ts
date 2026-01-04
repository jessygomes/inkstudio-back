import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { MailService } from 'src/email/mailer.service';
import { EmailTemplateData } from 'src/email/email-template.service';
import { AppointmentStatus, PrestationType } from '@prisma/client';

export interface SendResult {
  sent7Days: number;
  sent30Days: number;
}

@Injectable()
export class PostAppointmentEmailService {
  private readonly logger = new Logger('PostAppointmentEmailService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return 'Unknown error occurred';
  }

  private resolveRecipient(appointment: any): { email: string | null; name: string } {
    // Prefer connected client user, fallback to salon client record
    const clientUser = appointment.clientUser;
    if (clientUser?.email) {
      const name = `${clientUser.firstName || ''} ${clientUser.lastName || ''}`.trim() || 'Client';
      return { email: clientUser.email, name };
    }

    const client = appointment.client;
    if (client?.email) {
      const name = `${client.firstName || ''} ${client.lastName || ''}`.trim() || 'Client';
      return { email: client.email, name };
    }

    return { email: null, name: 'Client' };
  }

  private formatDate(date: Date): string {
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(date);
  }

  private daysBetween(from: Date, to: Date): number {
    const msPerDay = 24 * 60 * 60 * 1000;
    return Math.round((to.getTime() - from.getTime()) / msPerDay);
  }

  private getTatoueurName(appointment: any): string {
    const tatoueur = appointment.tatoueur;
    if (!tatoueur) return 'Votre tatoueur';
    const fullName = `${tatoueur.firstName || ''} ${tatoueur.lastName || ''}`.trim();
    return fullName || tatoueur.nickname || 'Votre tatoueur';
  }

  async sendDueEmails(): Promise<SendResult> {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // 7-day follow-up: TATTOO, PIERCING, RETOUCHE
    const sevenDayAppointments = await this.prisma.appointment.findMany({
      where: {
        status: AppointmentStatus.COMPLETED,
        prestation: { in: [PrestationType.TATTOO, PrestationType.PIERCING, PrestationType.RETOUCHE] },
        end: { lte: sevenDaysAgo },
        followUp7SentAt: null,
      },
      include: {
        user: true, // salon
        client: true,
        clientUser: true,
        tatoueur: true,
      },
      take: 200,
    });

    // 30-day follow-up: TATTOO only
    const thirtyDayAppointments = await this.prisma.appointment.findMany({
      where: {
        status: AppointmentStatus.COMPLETED,
        prestation: PrestationType.TATTOO,
        end: { lte: thirtyDaysAgo },
        followUp30SentAt: null,
      },
      include: {
        user: true,
        client: true,
        clientUser: true,
        tatoueur: true,
      },
      take: 200,
    });

    let sent7 = 0;
    for (const appt of sevenDayAppointments) {
      const recipient = this.resolveRecipient(appt);
      if (!recipient.email) {
        continue;
      }
      const salonName = appt.user?.salonName || appt.user?.firstName || 'Votre salon';
      const templateData: EmailTemplateData = {
        recipientName: recipient.name,
        salonName,
        followUpDetails: {
          appointmentDate: this.formatDate(appt.end),
          daysSince: this.daysBetween(appt.end, now),
        },
      };

      try {
        await this.mailService.sendFollowUp(recipient.email, templateData, salonName);
        await this.prisma.appointment.update({
          where: { id: appt.id },
          data: { followUp7SentAt: new Date() },
        });
        sent7 += 1;
      } catch (error) {
        this.logger.error('Failed to send 7-day follow-up', this.getErrorMessage(error));
      }
    }

    let sent30 = 0;
    for (const appt of thirtyDayAppointments) {
      const recipient = this.resolveRecipient(appt);
      if (!recipient.email) {
        continue;
      }
      const salonName = appt.user?.salonName || appt.user?.firstName || 'Votre salon';
      const templateData: EmailTemplateData = {
        recipientName: recipient.name,
        salonName,
        retouchesReminderDetails: {
          clientName: recipient.name,
          appointmentDate: this.formatDate(appt.end),
          tatoueurName: this.getTatoueurName(appt),
          salonName,
        },
      };

      try {
        await this.mailService.sendRetouchesReminder(recipient.email, templateData, salonName);
        await this.prisma.appointment.update({
          where: { id: appt.id },
          data: { followUp30SentAt: new Date() },
        });
        sent30 += 1;
      } catch (error) {
        this.logger.error('Failed to send 30-day follow-up', this.getErrorMessage(error));
      }
    }

    this.logger.log(`Post-appointment emails sent: 7-day=${sent7}, 30-day=${sent30}`);
    return { sent7Days: sent7, sent30Days: sent30 };
  }
}
