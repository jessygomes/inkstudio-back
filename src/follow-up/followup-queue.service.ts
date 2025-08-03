import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Injectable } from '@nestjs/common';

@Injectable()
export class FollowupQueueService {
  constructor(@InjectQueue('followup') private queue: Queue) {}

  async scheduleFollowup(appointmentId: string, end: Date) {
    const delayMs = Math.max(0, end.getTime() + 10 * 60 * 1000 - Date.now());

    console.log(`📅 Planification du suivi pour le RDV ${appointmentId} dans ${Math.round(delayMs / 1000)} secondes`);

    // Planifie l'envoi de l'email de suivi
    // 10 minutes après la fin du rendez-vous
    // avec un délai de 10 minutes pour éviter les envois immédiats

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