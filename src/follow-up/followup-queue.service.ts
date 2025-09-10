import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Injectable } from '@nestjs/common';
import { DEFAULT_FOLLOWUP_CONFIG, FollowUpConfig } from './follow-up.config';

@Injectable()
export class FollowupQueueService {
  constructor(@InjectQueue('followup') private queue: Queue) {}

  async scheduleFollowup(appointmentId: string, end: Date, config: FollowUpConfig = DEFAULT_FOLLOWUP_CONFIG) {
    const delayMs = Math.max(0, end.getTime() + config.delayMinutes * 60 * 1000 - Date.now());

    console.log(`📅 Planification du suivi pour le RDV ${appointmentId} dans ${Math.round(delayMs / 1000)} secondes (${config.delayMinutes} minutes après la fin)`);

    // Planifie l'envoi de l'email de suivi
    // Délai configurable après la fin du rendez-vous

    await this.queue.add(
      'sendFollowupEmail',
      { appointmentId },
      {
        delay: delayMs,
        jobId: `followup:${appointmentId}`,       // idempotent
        removeOnComplete: true,
        removeOnFail: true,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
      },
    );
  }
}