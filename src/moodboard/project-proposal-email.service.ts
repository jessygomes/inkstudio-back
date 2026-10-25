import { InjectQueue, Process, Processor } from '@nestjs/bull';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bull';
import { randomUUID } from 'crypto';
import { PrismaService } from 'src/database/prisma.service';
import { MailService } from 'src/email/mailer.service';
import { renderProjectProposalEmail } from 'src/email/project-proposal-email';

@Processor('project-proposal-emails')
export class ProjectProposalEmailService implements OnModuleInit {
  private readonly logger = new Logger(ProjectProposalEmailService.name);
  constructor(
    private prisma: PrismaService,
    private mail: MailService,
    @InjectQueue('project-proposal-emails') private queue: Queue,
  ) {}

  async onModuleInit() {
    try {
      await this.queue.add(
        'send-pending',
        {},
        {
          jobId: 'project-proposal-email-scan',
          repeat: { every: 60_000 },
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
      await this.requestDelivery();
    } catch {
      this.logger.error(
        'Impossible de planifier les emails de propositions. Les envois restent enregistrés en base.',
      );
    }
  }

  async requestDelivery() {
    try {
      await this.queue.add(
        'send-pending',
        {},
        {
          jobId: `project-proposal-email-${randomUUID()}`,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch {
      // The durable outbox will be picked up by the periodic worker.
      this.logger.warn(
        'Email de proposition enregistré ; mise en file Redis temporairement indisponible.',
      );
    }
  }

  @Process('send-pending')
  async sendPending() {
    return this.dispatch();
  }

  async dispatch(now = new Date()) {
    const stale = new Date(now.getTime() - 15 * 60_000);
    await this.prisma.projectProposalEmail.updateMany({
      where: { status: 'SENDING', attempts: { gte: 5 }, claimedAt: { lt: stale } },
      data: { status: 'FAILED', claimedAt: null },
    });
    const due = {
      attempts: { lt: 5 },
      OR: [
        { status: 'PENDING', nextAttemptAt: { lte: now } },
        { status: 'SENDING', claimedAt: { lt: stale } },
      ],
    };
    const emails = await this.prisma.projectProposalEmail.findMany({
      where: due,
      take: 25,
      orderBy: { createdAt: 'asc' },
    });
    let sent = 0;
    for (const email of emails) {
      const claim = await this.prisma.projectProposalEmail.updateMany({
        where: { id: email.id, ...due },
        data: { status: 'SENDING', claimedAt: now, attempts: { increment: 1 } },
      });
      if (!claim.count) continue;
      try {
        const board = await this.prisma.moodboard.findUnique({
          where: { id: email.moodboardId },
          select: {
            name: true,
            clientProfile: { select: { user: { select: { email: true } } } },
          },
        });
        if (!board) continue; // Cascade deletion also removed the outbox row.
        const rendered = renderProjectProposalEmail(
          board.name,
          email.threshold,
        );
        await this.mail.sendMail(
          board.clientProfile.user.email,
          rendered.subject,
          rendered.html,
          'Inkera People',
        );
        await this.prisma.projectProposalEmail.update({
          where: { id: email.id },
          data: { status: 'SENT', sentAt: new Date(), claimedAt: null },
        });
        sent++;
      } catch {
        const attempts = email.attempts + 1;
        await this.prisma.projectProposalEmail.updateMany({
          where: { id: email.id, status: 'SENDING', claimedAt: now },
          data: {
            status: attempts >= 5 ? 'FAILED' : 'PENDING',
            claimedAt: null,
            nextAttemptAt: new Date(
              now.getTime() + Math.min(60, 2 ** attempts) * 60_000,
            ),
          },
        });
        this.logger.warn(
          `Échec d'envoi de l'email de proposition ${email.id}, tentative ${attempts}/5.`,
        );
      }
    }
    return { sent };
  }
}
