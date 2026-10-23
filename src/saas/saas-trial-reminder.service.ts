import { InjectQueue } from '@nestjs/bull';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bull';
import { createHash } from 'crypto';
import { SaasPlan, SaasPlanStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { MailService } from '../email/mailer.service';
import { DAY_MS, reminderMilestones } from './trial-policy';

export type TrialReminderJobData = { userId: string; trialEndDate: string; daysBeforeEnd: number };

@Injectable()
export class SaasTrialReminderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    @InjectQueue('saas-billing') private readonly queue: Queue,
  ) {}

  async schedule(now = new Date()) {
    const trials = await this.prisma.saasPlanDetails.findMany({
      where: {
        planStatus: SaasPlanStatus.TRIAL,
        currentPlan: { in: [SaasPlan.PRO, SaasPlan.BUSINESS] },
        trialEndDate: { gt: now, lte: new Date(now.getTime() + 7 * DAY_MS) },
        user: { stripeSubscriptionId: null, role: { in: ['user_salon', 'user_tatoueur'] } },
      },
      select: { userId: true, trialEndDate: true },
    });
    let scheduled = 0;
    for (const trial of trials) {
      if (!trial.trialEndDate) continue;
      for (const milestone of reminderMilestones(trial.trialEndDate, now)) {
        const data: TrialReminderJobData = { userId: trial.userId, trialEndDate: trial.trialEndDate.toISOString(), daysBeforeEnd: milestone.daysBeforeEnd };
        const identity = createHash('sha256').update(JSON.stringify(data)).digest('hex');
        await this.queue.add('trial-reminder', data, {
          jobId: `trial-reminder-${identity}`,
          delay: milestone.delay,
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
          // Retain completed identities so repeated scans and restarts don't resend.
          removeOnComplete: false,
          removeOnFail: false,
        });
        scheduled++;
      }
    }
    return { scanned: trials.length, scheduled };
  }

  async send(data: TrialReminderJobData, now = new Date()) {
    const trial = await this.prisma.saasPlanDetails.findUnique({
      where: { userId: data.userId },
      include: { user: { select: { email: true, firstName: true, salonName: true, stripeSubscriptionId: true, role: true } } },
    });
    if (!trial || trial.planStatus !== SaasPlanStatus.TRIAL ||
        !trial.trialEndDate || trial.trialEndDate.toISOString() !== data.trialEndDate ||
        trial.trialEndDate <= now || trial.user.stripeSubscriptionId ||
        !((trial.currentPlan === SaasPlan.PRO && trial.user.role === 'user_tatoueur') ||
          (trial.currentPlan === SaasPlan.BUSINESS && trial.user.role === 'user_salon'))) return { skipped: true };

    // Do not deliver an old J-7/J-3 retry after the next milestone has arrived.
    const daysLeft = (trial.trialEndDate.getTime() - now.getTime()) / DAY_MS;
    const nextMilestone = data.daysBeforeEnd === 7 ? 3 : data.daysBeforeEnd === 3 ? 1 : 0;
    if (daysLeft <= nextMilestone || daysLeft > data.daysBeforeEnd) return { skipped: true };

    await this.mail.sendTrialEndingSoonReminder(trial.user.email, {
      recipientName: trial.user.firstName || trial.user.salonName || 'Bonjour',
      salonName: 'Inkera Studio',
      trialEndDate: trial.trialEndDate.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long', timeStyle: 'short' }),
      planName: trial.currentPlan === SaasPlan.BUSINESS ? 'Business' : 'Pro',
    });
    return { sent: true };
  }
}
