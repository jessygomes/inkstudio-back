import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { MailService } from '../email/mailer.service';

/**
 * Envoi idempotent : une clé (ex. `entry:<id>:confirmation`) n'est envoyée
 * qu'une fois. Un échec est enregistré et peut être retenté ; il ne fait jamais
 * échouer l'action métier qui a déclenché l'envoi.
 */
@Injectable()
export class GiveawayMailerService {
  private readonly logger = new Logger(GiveawayMailerService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async sendOnce(key: string, kind: string, to: string | null | undefined, message: { subject: string; html: string }, userId?: string | null): Promise<'SENT' | 'SKIPPED' | 'FAILED'> {
    if (!to) return 'SKIPPED';
    try {
      await this.prisma.giveawayEmailDelivery.create({ data: { key, kind, userId: userId ?? null } });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      // Déjà envoyé ou en cours : on ne retente que les échecs, en réservant la ligne de façon atomique.
      const claimed = await this.prisma.giveawayEmailDelivery.updateMany({
        where: { key, status: 'FAILED' },
        data: { status: 'PENDING' },
      });
      if (!claimed.count) return 'SKIPPED';
    }
    try {
      await this.mail.sendMail(to, message.subject, message.html, 'Inkera');
      await this.prisma.giveawayEmailDelivery.update({
        where: { key },
        data: { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 }, lastError: null },
      });
      return 'SENT';
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 300) : 'unknown';
      this.logger.warn(JSON.stringify({ event: 'giveaway.email.failed', key, kind }));
      await this.prisma.giveawayEmailDelivery
        .update({ where: { key }, data: { status: 'FAILED', attempts: { increment: 1 }, lastError: reason } })
        .catch(() => undefined);
      return 'FAILED';
    }
  }

  adminEmail(): string {
    return process.env.GIVEAWAY_ADMIN_EMAIL || process.env.ADMIN_EMAIL || 'contact.inkera@gmail.com';
  }
}
