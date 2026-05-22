import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bull';

@Injectable()
export class SaasBillingScheduler implements OnModuleInit {
  private readonly logger = new Logger(SaasBillingScheduler.name);
  private readonly jobName = 'downgrade-past-due';

  constructor(@InjectQueue('saas-billing') private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    // Nettoie les anciennes occurrences répétables pour éviter les doublons
    // lors des redémarrages de l'application.
    const repeats = await this.queue.getRepeatableJobs();
    await Promise.all(
      repeats
        .filter((job) => job.name === this.jobName)
        .map((job) => this.queue.removeRepeatableByKey(job.key)),
    );

    // Lance une vérification quotidienne des comptes en past_due.
    await this.queue.add(
      this.jobName,
      {},
      {
        repeat: { cron: '0 8 * * *' }, // Tous les jours à 08:00
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: { type: 'fixed', delay: 30_000 },
      },
    );

    this.logger.log('Planification quotidienne du contrôle past_due à 08:00');
  }
}
