import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { SaasTrialReminderService, TrialReminderJobData } from './saas-trial-reminder.service';
import { Logger } from '@nestjs/common';
import { SaasService } from './saas.service';

@Processor('saas-billing')
export class SaasBillingJob {
  private readonly logger = new Logger(SaasBillingJob.name);

  constructor(private readonly saasService: SaasService, private readonly reminders: SaasTrialReminderService) {}

  // Traite le job quotidien qui rétrograde les comptes en past_due
  // depuis plus de 5 jours vers le plan FREE.
  @Process('trial-reminder')
  async sendReminder(job: Job<TrialReminderJobData>) { return this.reminders.send(job.data); }

  @Process('downgrade-past-due')
  async handle() {
    await this.reminders.schedule();
    const pastDueResult = await this.saasService.downgradeExpiredPastDueUsers(5);
    const trialResult = await this.saasService.downgradeExpiredTrialUsers();

    this.logger.log(
      `Scan billing terminé: past_due(scannés=${pastDueResult.scanned}, downgradés=${pastDueResult.downgraded}) | trial(scannés=${trialResult.scanned}, downgradés=${trialResult.downgraded})`,
    );

    return {
      pastDue: pastDueResult,
      trial: trialResult,
    };
  }
}
