import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Injectable } from '@nestjs/common';
import { DEFAULT_FOLLOWUP_CONFIG, FollowUpConfig } from './follow-up.config';

@Injectable()
export class FollowupQueueService {
  constructor(@InjectQueue('followup') private queue: Queue) {}

  // Méthode centralisée d'enqueue: applique les options communes (retry, backoff, cleanup).
  private async scheduleJob(jobName: 'sendFollowupEmail' | 'sendRetouchesReminderEmail', jobId: string, appointmentId: string, runAt: Date) {
    // Si la date est dans le passé, Bull exécute le job dès que possible.
    const delayMs = Math.max(0, runAt.getTime() - Date.now());

    await this.queue.add(
      jobName,
      { appointmentId },
      {
        // Délai avant exécution du job.
        delay: delayMs,
        // jobId déterministe: évite les doublons pour un même RDV/type.
        jobId,
        // Nettoyage automatique des jobs terminés/échoués.
        removeOnComplete: true,
        removeOnFail: true,
        // Tolérance aux erreurs temporaires de mail/DB.
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
      },
    );
  }

  // API historique: planifie un suivi depuis la fin du RDV avec config en minutes.
  async scheduleFollowup(appointmentId: string, end: Date, config: FollowUpConfig = DEFAULT_FOLLOWUP_CONFIG) {
    const runAt = new Date(end.getTime() + config.delayMinutes * 60 * 1000);

    console.log(`📅 Planification du suivi pour le RDV ${appointmentId} (${config.delayMinutes} minutes après la fin)`);

    // Enqueue du job suivi avec un jobId stable par appointment.
    await this.scheduleJob('sendFollowupEmail', `followup:${appointmentId}`, appointmentId, runAt);
  }

  // Planifie le suivi à partir de l'heure de completion réelle (flux appointments).
  async scheduleFollowupFromCompletion(appointmentId: string, completionTime: Date, delayMinutes: number) {
    const runAt = new Date(completionTime.getTime() + delayMinutes * 60 * 1000);
    await this.scheduleJob('sendFollowupEmail', `followup:${appointmentId}`, appointmentId, runAt);
  }

  // Planifie le rappel retouches à partir de la completion.
  async scheduleRetouchesFromCompletion(appointmentId: string, completionTime: Date, delayMinutes: number) {
    const runAt = new Date(completionTime.getTime() + delayMinutes * 60 * 1000);
    await this.scheduleJob('sendRetouchesReminderEmail', `retouches:${appointmentId}`, appointmentId, runAt);
  }
}