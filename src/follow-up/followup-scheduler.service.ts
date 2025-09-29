import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { MailService } from 'src/email/mailer.service';
import { randomUUID } from 'crypto';

@Injectable()
export class FollowupSchedulerService {
  private readonly logger = new Logger(FollowupSchedulerService.name);
  private scheduledJobs = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  /**
   * Planifie l'envoi d'un email de suivi 10 minutes après la fin du RDV
   * @param appointmentId - ID du rendez-vous
   * @param endTime - Date de fin du rendez-vous
   */
  async scheduleFollowup(appointmentId: string, endTime: Date) {
    try {
      // Calculer le délai : 10 minutes après la fin du RDV
      const followupTime = new Date(endTime.getTime() + 10 * 60 * 1000);
      const delayMs = Math.max(0, followupTime.getTime() - Date.now());

      this.logger.log(`📅 Planification du suivi pour le RDV ${appointmentId} dans ${Math.round(delayMs / 1000)} secondes`);

      // Si le RDV est déjà passé (+ 10 min), envoyer immédiatement
      if (delayMs === 0) {
        this.logger.log(`⚡ RDV ${appointmentId} déjà passé, envoi immédiat du suivi`);
        await this.sendFollowupEmail(appointmentId);
        return;
      }

      // Annuler un éventuel job précédent pour ce RDV
      this.cancelScheduledJob(appointmentId);

      // Planifier le nouveau job
      const timeoutId = setTimeout(() => {
        this.sendFollowupEmail(appointmentId)
          .then(() => {
            this.scheduledJobs.delete(appointmentId);
          })
          .catch((error) => {
            this.logger.error(`❌ Erreur lors de l'envoi du suivi pour ${appointmentId}:`, error);
          });
      }, delayMs);

      // Sauvegarder le job pour pouvoir l'annuler si nécessaire
      this.scheduledJobs.set(appointmentId, timeoutId);

      this.logger.log(`✅ Suivi planifié pour le RDV ${appointmentId} à ${followupTime.toLocaleString()}`);

    } catch (error) {
      this.logger.error(`❌ Erreur lors de la planification du suivi pour ${appointmentId}:`, error);
    }
  }

  /**
   * Annule la planification d'un suivi pour un RDV
   * @param appointmentId - ID du rendez-vous
   */
  cancelScheduledJob(appointmentId: string) {
    const existingJob = this.scheduledJobs.get(appointmentId);
    if (existingJob) {
      clearTimeout(existingJob);
      this.scheduledJobs.delete(appointmentId);
      this.logger.log(`🗑️ Job de suivi annulé pour le RDV ${appointmentId}`);
    }
  }

  /**
   * Envoie l'email de suivi pour un rendez-vous
   * @param appointmentId - ID du rendez-vous
   */
  private async sendFollowupEmail(appointmentId: string) {
    try {
      // Récupérer les informations du rendez-vous
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          client: true,
          tatoueur: {
            select: {
              name: true,
            },
          },
          user: {
            select: {
              salonName: true,
            },
          },
        },
      });

      if (!appointment) {
        this.logger.warn(`⚠️ RDV ${appointmentId} introuvable pour l'envoi du suivi`);
        return;
      }

      if (!appointment.client) {
        this.logger.warn(`⚠️ Pas de client associé au RDV ${appointmentId}`);
        return;
      }

      // Vérifier que le RDV est bien confirmé ou terminé
      if (!['CONFIRMED', 'COMPLETED'].includes(appointment.status)) {
        this.logger.warn(`⚠️ RDV ${appointmentId} non éligible pour suivi (status: ${appointment.status}), pas d'envoi de suivi`);
        return;
      }

      // Créer un token unique pour le suivi
      const token = randomUUID();

      // Vérifier qu'il n'y a pas déjà un suivi en cours pour ce RDV
      const existingRequest = await this.prisma.followUpRequest.findUnique({
        where: { appointmentId },
      });

      if (existingRequest) {
        this.logger.log(`⚠️ Un suivi existe déjà pour le RDV ${appointmentId}, mise à jour du token`);
        // Mettre à jour avec un nouveau token si nécessaire
        await this.prisma.followUpRequest.update({
          where: { appointmentId },
          data: {
            token,
            status: 'PENDING',
            sentAt: new Date(),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            userId: appointment.userId, // Ajouter le salon
          },
        });
      } else {
        // Créer une nouvelle entrée de suivi
        await this.prisma.followUpRequest.create({
          data: {
            appointmentId,
            token,
            status: 'PENDING',
            sentAt: new Date(),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Expire dans 7 jours
            userId: appointment.userId, // Ajouter le salon
          },
        });
      }

      // URL de suivi (à adapter selon votre frontend)
      const followupUrl = `${process.env.WEB_URL}/suivi/${token}`;

      // Envoyer l'email de demande d'avis
      await this.mailService.sendCicatrisationFollowUp(appointment.client.email, {
        cicatrisationFollowUpDetails: {
          clientName: `${appointment.client.firstName} ${appointment.client.lastName}`,
          prestationName: appointment.prestation,
          tatoueurName: appointment.tatoueur?.name || 'Non assigné',
          followUpUrl: followupUrl
        }
      }, appointment.user?.salonName || undefined);

      this.logger.log(`✅ Email de suivi envoyé avec succès pour le RDV ${appointmentId} à ${appointment.client.email}`);

    } catch (error) {
      this.logger.error(`❌ Erreur lors de l'envoi de l'email de suivi pour ${appointmentId}:`, error);
      throw error;
    }
  }

  /**
   * Envoie immédiatement un email de suivi pour un RDV terminé
   * Utilisé quand le salon marque un RDV TATTOO/PIERCING comme COMPLETED
   * @param appointmentId - ID du rendez-vous
   */
  async sendImmediateFollowup(appointmentId: string) {
    try {
      this.logger.log(`📧 Envoi immédiat du suivi de cicatrisation pour le RDV ${appointmentId}`);
      
      // Utiliser la méthode existante pour envoyer l'email
      await this.sendFollowupEmail(appointmentId);
      
      this.logger.log(`✅ Suivi de cicatrisation envoyé avec succès pour le RDV ${appointmentId}`);
    } catch (error) {
      this.logger.error(`❌ Erreur lors de l'envoi immédiat du suivi pour ${appointmentId}:`, error);
      throw error;
    }
  }

  /**
   * Méthode pour récupérer les statistiques des jobs planifiés (debug)
   */
  getScheduledJobsStats() {
    return {
      totalJobs: this.scheduledJobs.size,
      jobIds: Array.from(this.scheduledJobs.keys()),
    };
  }

  /**
   * Méthode pour nettoyer tous les jobs (utile pour les tests ou l'arrêt de l'app)
   */
  clearAllJobs() {
    for (const [, timeoutId] of this.scheduledJobs.entries()) {
      clearTimeout(timeoutId);
    }
    this.scheduledJobs.clear();
    this.logger.log('🧹 Tous les jobs de suivi ont été nettoyés');
  }
}
