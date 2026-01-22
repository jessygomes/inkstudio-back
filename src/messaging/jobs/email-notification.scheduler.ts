import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Queue } from 'bull';
import { InjectQueue } from '@nestjs/bull';

@Injectable()
export class EmailNotificationScheduler implements OnModuleInit {
  private readonly logger = new Logger('EmailNotificationScheduler');

  constructor(
    @InjectQueue('email-notifications') private emailQueue: Queue,
  ) {}

  /**
   * Initialise le scheduler au démarrage du module
   */
  async onModuleInit(): Promise<void> {

    // Créer un job récurrent qui s'exécute toutes les 5 minutes
    await this.scheduleEmailNotifications();

    // Lancer une exécution immédiate au démarrage pour vider les envois en attente
    await this.emailQueue.add(
      'send-queued',
      {},
      {
        jobId: 'send-email-notifications-once',
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  /**
   * Planifie l'envoi des emails en attente toutes les 5 minutes
   */
  private async scheduleEmailNotifications(): Promise<void> {
    try {
      // Supprimer les anciens jobs récurrents (pour éviter les doublons)
      const jobs = await this.emailQueue.getRepeatableJobs();
      for (const job of jobs) {
        if (job.key === 'send-email-notifications') {
          await this.emailQueue.removeRepeatableByKey(job.key);
        }
      }

      // Ajouter un nouveau job récurrent toutes les 5 minutes
      await this.emailQueue.add(
        'send-queued',
        {},
        {
          repeat: {
            every: 5 * 60 * 1000, // 5 minutes en millisecondes
          },
          jobId: 'send-email-notifications',
          attempts: 3, // Réessayer 3 fois en cas d'erreur
          backoff: {
            type: 'fixed',
            delay: 30000, // Attendre 30s avant réessai
          },
        },
      );

      this.logger.log(
        '✅ Email notification job scheduled to run every 5 minutes',
      );
    } catch (error: unknown) {
      this.logger.error(
        `❌ Erreur lors de la planification des notifications: ${this.getErrorMessage(error)}`,
      );
    }
  }

  /**
   * Normalise une erreur inconnue en message lisible
   */
  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return 'Erreur inconnue';
  }
}
