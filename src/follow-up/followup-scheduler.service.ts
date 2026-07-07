import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { FollowupQueueService } from './followup-queue.service';

@Injectable()
export class FollowupSchedulerService {
  private readonly logger = new Logger(FollowupSchedulerService.name);
  // Valeurs fallback si le salon n'a pas configuré ses délais.
  private readonly defaultFollowUpDelayDays = 7;
  private readonly defaultRetouchDelayDays = 30;

  constructor(
    private readonly prisma: PrismaService,
    private readonly followupQueueService: FollowupQueueService,
  ) {}

  // Sécurise la valeur de délai (entier >= 1), sinon retourne le fallback.
  private normalizeDelayDays(value: number | null | undefined, fallback: number): number {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return fallback;
    }

    return Math.max(1, Math.round(value));
  }

  // Lit les délais paramétrés au niveau du salon pour le RDV concerné.
  private async resolveDelayDaysForAppointment(appointmentId: string): Promise<{
    followUpDelayDays: number;
    retouchDelayDays: number;
  }> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        user: {
          select: {
            followUpEmailDelayDays: true,
            retouchEmailDelayDays: true,
          },
        },
      },
    });

    return {
      followUpDelayDays: this.normalizeDelayDays(
        appointment?.user?.followUpEmailDelayDays,
        this.defaultFollowUpDelayDays,
      ),
      retouchDelayDays: this.normalizeDelayDays(
        appointment?.user?.retouchEmailDelayDays,
        this.defaultRetouchDelayDays,
      ),
    };
  }

  // Traduit la règle métier en minutes puis délègue la planification à Bull.
  private async queueFollowupFromDate(appointmentId: string, baseTime: Date): Promise<void> {
    // En dev on garde un délai court pour test rapide; en prod on respecte la config en jours.
    const isProduction = process.env.NODE_ENV === 'production';
    const { followUpDelayDays } = await this.resolveDelayDaysForAppointment(appointmentId);
    const delayMinutes = isProduction ? followUpDelayDays * 24 * 60 : 10;

    await this.followupQueueService.scheduleFollowupFromCompletion(
      appointmentId,
      baseTime,
      delayMinutes,
    );

    this.logger.log(
      `✅ Suivi cicatrisation planifié via Bull pour le RDV ${appointmentId} (${isProduction ? `J+${followUpDelayDays}` : '10 min'})`,
    );
  }

  // Même principe que ci-dessus mais pour le rappel retouches.
  private async queueRetouchesFromDate(appointmentId: string, baseTime: Date): Promise<void> {
    const isProduction = process.env.NODE_ENV === 'production';
    const { retouchDelayDays } = await this.resolveDelayDaysForAppointment(appointmentId);
    const delayMinutes = isProduction ? retouchDelayDays * 24 * 60 : 15;

    await this.followupQueueService.scheduleRetouchesFromCompletion(
      appointmentId,
      baseTime,
      delayMinutes,
    );

    this.logger.log(
      `✅ Rappel retouches planifié via Bull pour le RDV ${appointmentId} (${isProduction ? `J+${retouchDelayDays}` : '15 min'})`,
    );
  }

  // API compatible historique: planification depuis l'heure de fin du RDV.
  async scheduleFollowup(appointmentId: string, endTime: Date) {
    try {
      await this.queueFollowupFromDate(appointmentId, endTime);
    } catch (error) {
      this.logger.error(
        `❌ Erreur lors de la planification Bull du suivi pour ${appointmentId}:`,
        error,
      );
      throw error;
    }
  }

  // Force un envoi quasi immédiat en queue (delay=0).
  async sendImmediateFollowup(appointmentId: string) {
    try {
      await this.followupQueueService.scheduleFollowupFromCompletion(
        appointmentId,
        new Date(),
        0,
      );

      this.logger.log(`✅ Suivi immédiat planifié via Bull pour le RDV ${appointmentId}`);
    } catch (error) {
      this.logger.error(
        `❌ Erreur lors de la planification immédiate du suivi pour ${appointmentId}:`,
        error,
      );
      throw error;
    }
  }

  // Point d'entrée principal appelé lors du passage de statut à COMPLETED.
  async scheduleFollowupFromCompletion(appointmentId: string, completionTime: Date): Promise<void> {
    try {
      await this.queueFollowupFromDate(appointmentId, completionTime);
    } catch (error) {
      this.logger.error(
        `❌ Erreur lors de la planification du suivi depuis completion pour ${appointmentId}:`,
        error,
      );
      throw error;
    }
  }

  // Planifie le rappel retouches après completion.
  async scheduleRetouchesReminderFromCompletion(appointmentId: string, completionTime: Date): Promise<void> {
    try {
      await this.queueRetouchesFromDate(appointmentId, completionTime);
    } catch (error) {
      this.logger.error(
        `❌ Erreur lors de la planification des retouches pour ${appointmentId}:`,
        error,
      );
      throw error;
    }
  }

  // Méthode legacy conservée pour compatibilité d'anciens appels.
  scheduleRetouchesReminder(appointmentId: string, appointmentDate: Date, endTime?: Date): void {
    const baseTime = endTime ?? appointmentDate;

    // Fire-and-forget volontaire: l'appelant legacy n'attend pas de Promise.
    void this.queueRetouchesFromDate(appointmentId, baseTime).catch((error) => {
      this.logger.error(
        `❌ Erreur lors de la planification legacy des retouches pour ${appointmentId}:`,
        error,
      );
    });
  }

  // Placeholder legacy: l'annulation nécessite une API Bull dédiée (jobId/remove).
  cancelScheduledJob(_appointmentId: string) {
    void _appointmentId;
    this.logger.warn('cancelScheduledJob est non supporté en mode Bull sans API d’annulation dédiée.');
  }

  // Placeholder stats: prévoir une interrogation de queue Bull pour stats réelles.
  getScheduledJobsStats() {
    return {
      totalJobs: -1,
      jobIds: [],
      mode: 'bull',
    };
  }

  // Aide de debug pour vérifier la stratégie de délai active selon environnement.
  testDelayCalculation(): { cicatrisation: string; retouches: string; environment: string } {
    const isProduction = process.env.NODE_ENV === 'production';

    return {
      environment: isProduction ? 'PRODUCTION' : 'DÉVELOPPEMENT',
      cicatrisation: isProduction ? 'Délai configurable en jours (Bull)' : '10 minutes (Bull)',
      retouches: isProduction ? 'Délai configurable en jours (Bull)' : '15 minutes (Bull)',
    };
  }

  // Placeholder legacy: le nettoyage Bull global doit être géré via API d'admin queue.
  clearAllJobs() {
    this.logger.warn('clearAllJobs n’efface pas Bull ici; utilisez une admin queue dédiée si nécessaire.');
  }
}
