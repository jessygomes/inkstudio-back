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
   * Planifie l'envoi d'un email de suivi selon l'environnement
   * - TEST: 10 minutes après la fin du RDV
   * - PRODUCTION: 1 semaine après la fin du RDV
   * @param appointmentId - ID du rendez-vous
   * @param endTime - Date de fin du rendez-vous
   */
  async scheduleFollowup(appointmentId: string, endTime: Date) {
    try {
      // Déterminer le délai selon l'environnement
      const isProduction = process.env.NODE_ENV === 'production';
      const delayMinutes = isProduction ? 7 * 24 * 60 : 10; // 1 semaine en production, 10 min en test
      
      // Calculer le délai
      const followupTime = new Date(endTime.getTime() + delayMinutes * 60 * 1000);
      const delayMs = Math.max(0, followupTime.getTime() - Date.now());

      this.logger.log(`📅 Planification du suivi (${isProduction ? 'PRODUCTION - 1 semaine' : 'TEST - 10 minutes'}) pour le RDV ${appointmentId} dans ${Math.round(delayMs / 1000)} secondes`);

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
      const followupUrl = `${process.env.FRONTEND_URL}/suivi/${token}`;

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
   * Planifie l'envoi d'un email de suivi de cicatrisation à partir du moment de completion
   * - DÉVELOPPEMENT: 10 minutes après la completion
   * - PRODUCTION: 7 jours après la completion
   * @param appointmentId - ID du rendez-vous
   * @param completionTime - Moment où le RDV a été marqué comme terminé
   */
  async scheduleFollowupFromCompletion(appointmentId: string, completionTime: Date): Promise<void> {
    try {
      // Déterminer le délai selon l'environnement
      const isProduction = process.env.NODE_ENV === 'production';
      const delayMinutes = isProduction ? 7 * 24 * 60 : 10; // 7 jours en production, 10 min en développement
      
      // Calculer le délai à partir du moment de completion
      const followupTime = new Date(completionTime.getTime() + delayMinutes * 60 * 1000);
      const delayMs = Math.max(0, followupTime.getTime() - Date.now());

      this.logger.log(`📅 Planification du suivi cicatrisation (${isProduction ? 'PRODUCTION - 7 jours' : 'DÉVELOPPEMENT - 10 minutes'}) pour le RDV ${appointmentId} dans ${Math.round(delayMs / 1000)} secondes`);

      // Si le délai est déjà passé, envoyer immédiatement
      if (delayMs === 0) {
        this.logger.log(`⚡ Délai de suivi déjà passé pour le RDV ${appointmentId}, envoi immédiat`);
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

      this.logger.log(`✅ Suivi cicatrisation planifié pour le RDV ${appointmentId} à ${followupTime.toLocaleString()}`);

    } catch (error) {
      this.logger.error(`❌ Erreur lors de la planification du suivi pour ${appointmentId}:`, error);
      throw error;
    }
  }

  /**
   * Planifie l'envoi d'un email de rappel pour retouches selon l'environnement
   * - DÉVELOPPEMENT: 15 minutes après la completion
   * - PRODUCTION: 30 jours après la completion
   * @param appointmentId - ID du rendez-vous
   * @param completionTime - Moment où le RDV a été marqué comme terminé
   */
  scheduleRetouchesReminderFromCompletion(appointmentId: string, completionTime: Date): void {
    try {
      // Déterminer le délai selon l'environnement
      const isProduction = process.env.NODE_ENV === 'production';
      
      let reminderTime: Date;
      let delayMs: number;
      
      if (isProduction) {
        // Production : 30 jours après la completion
        reminderTime = new Date(completionTime.getTime() + 30 * 24 * 60 * 60 * 1000);
        delayMs = Math.max(0, reminderTime.getTime() - Date.now());
      } else {
        // Développement : 15 minutes après la completion
        reminderTime = new Date(completionTime.getTime() + 15 * 60 * 1000);
        delayMs = Math.max(0, reminderTime.getTime() - Date.now());
      }

      const delayDescription = isProduction 
        ? `${Math.round(delayMs / (1000 * 60 * 60 * 24))} jours`
        : `${Math.round(delayMs / (1000 * 60))} minutes`;

      this.logger.log(`📅 Planification du rappel retouches (${isProduction ? 'PRODUCTION - 30 jours' : 'DÉVELOPPEMENT - 15 minutes'}) pour le RDV ${appointmentId} dans ${delayDescription}`);

      // Si la date est déjà passée, ne pas envoyer
      if (delayMs === 0) {
        this.logger.log(`⚠️ Date du rappel retouches déjà passée pour le RDV ${appointmentId}, pas d'envoi`);
        return;
      }

      // Clé unique pour les rappels retouches
      const retouchesJobKey = `retouches_${appointmentId}`;

      // Annuler un éventuel job précédent pour ce RDV
      this.cancelScheduledJob(retouchesJobKey);

      // Planifier le nouveau job
      const timeoutId = setTimeout(() => {
        this.sendRetouchesReminderEmail(appointmentId)
          .then(() => {
            this.scheduledJobs.delete(retouchesJobKey);
          })
          .catch((error) => {
            this.logger.error(`❌ Erreur lors de l'envoi du rappel retouches pour ${appointmentId}:`, error);
          });
      }, delayMs);

      // Sauvegarder le job pour pouvoir l'annuler si nécessaire
      this.scheduledJobs.set(retouchesJobKey, timeoutId);

      this.logger.log(`✅ Rappel retouches planifié pour le RDV ${appointmentId} le ${reminderTime.toLocaleString()}`);

    } catch (error) {
      this.logger.error(`❌ Erreur lors de la planification du rappel retouches pour ${appointmentId}:`, error);
    }
  }

  /**
   * Planifie l'envoi d'un email de rappel pour retouches selon l'environnement
   * - DÉVELOPPEMENT: 15 minutes après la fin du RDV
   * - PRODUCTION: 1 mois après la date du tatouage
   * @param appointmentId - ID du rendez-vous
   * @param appointmentDate - Date du rendez-vous de tatouage
   * @param endTime - Date de fin du rendez-vous (pour calcul en développement)
   * @deprecated Utilisez scheduleRetouchesReminderFromCompletion à la place
   */
  scheduleRetouchesReminder(appointmentId: string, appointmentDate: Date, endTime?: Date): void {
    try {
      // Déterminer le délai selon l'environnement
      const isProduction = process.env.NODE_ENV === 'production';
      
      let reminderTime: Date;
      let delayMs: number;
      
      if (isProduction) {
        // Production : 1 mois après la date du tatouage
        reminderTime = new Date(appointmentDate.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 jours
        delayMs = Math.max(0, reminderTime.getTime() - Date.now());
      } else {
        // Développement : 15 minutes après la fin du RDV
        const endDate = endTime || appointmentDate;
        reminderTime = new Date(endDate.getTime() + 15 * 60 * 1000); // 15 minutes
        delayMs = Math.max(0, reminderTime.getTime() - Date.now());
      }

      const delayDescription = isProduction 
        ? `${Math.round(delayMs / (1000 * 60 * 60 * 24))} jours`
        : `${Math.round(delayMs / (1000 * 60))} minutes`;

      this.logger.log(`📅 Planification du rappel retouches (${isProduction ? 'PRODUCTION - 1 mois' : 'DÉVELOPPEMENT - 15 minutes'}) pour le RDV ${appointmentId} dans ${delayDescription}`);

      // Si la date est déjà passée, ne pas envoyer
      if (delayMs === 0) {
        this.logger.log(`⚠️ Date du rappel retouches déjà passée pour le RDV ${appointmentId}, pas d'envoi`);
        return;
      }

      // Clé unique pour les rappels retouches
      const retouchesJobKey = `retouches_${appointmentId}`;

      // Annuler un éventuel job précédent pour ce RDV
      this.cancelScheduledJob(retouchesJobKey);

      // Planifier le nouveau job
      const timeoutId = setTimeout(() => {
        this.sendRetouchesReminderEmail(appointmentId)
          .then(() => {
            this.scheduledJobs.delete(retouchesJobKey);
          })
          .catch((error) => {
            this.logger.error(`❌ Erreur lors de l'envoi du rappel retouches pour ${appointmentId}:`, error);
          });
      }, delayMs);

      // Sauvegarder le job pour pouvoir l'annuler si nécessaire
      this.scheduledJobs.set(retouchesJobKey, timeoutId);

      this.logger.log(`✅ Rappel retouches planifié pour le RDV ${appointmentId} le ${reminderTime.toLocaleString()}`);

    } catch (error) {
      this.logger.error(`❌ Erreur lors de la planification du rappel retouches pour ${appointmentId}:`, error);
    }
  }

  /**
   * Envoie l'email de rappel pour retouches
   * @param appointmentId - ID du rendez-vous de tatouage
   */
  private async sendRetouchesReminderEmail(appointmentId: string) {
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
        this.logger.warn(`⚠️ RDV ${appointmentId} introuvable pour l'envoi du rappel retouches`);
        return;
      }

      if (!appointment.client) {
        this.logger.warn(`⚠️ Pas de client associé au RDV ${appointmentId}`);
        return;
      }

      // Vérifier que c'est bien un tatouage complété
      if (appointment.prestation !== 'TATTOO' || appointment.status !== 'COMPLETED') {
        this.logger.warn(`⚠️ RDV ${appointmentId} non éligible pour rappel retouches (prestation: ${appointment.prestation}, status: ${appointment.status})`);
        return;
      }

      // Envoyer l'email de rappel retouches
      await this.mailService.sendRetouchesReminder(appointment.client.email, {
        recipientName: `${appointment.client.firstName} ${appointment.client.lastName}`,
        retouchesReminderDetails: {
          clientName: `${appointment.client.firstName} ${appointment.client.lastName}`,
          appointmentDate: appointment.start.toLocaleDateString('fr-FR', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          }),
          tatoueurName: appointment.tatoueur?.name || 'Non assigné',
          salonName: appointment.user?.salonName || 'Notre salon'
        }
      }, appointment.user?.salonName || undefined);

      this.logger.log(`✅ Email de rappel retouches envoyé avec succès pour le RDV ${appointmentId} à ${appointment.client.email}`);

    } catch (error) {
      this.logger.error(`❌ Erreur lors de l'envoi de l'email de rappel retouches pour ${appointmentId}:`, error);
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
   * Méthode de test pour vérifier les délais selon l'environnement
   * Simule les délais à partir du moment de completion d'un RDV
   */
  testDelayCalculation(): { cicatrisation: string; retouches: string; environment: string } {
    const isProduction = process.env.NODE_ENV === 'production';
    const completionTime = new Date(); // Simule le moment où un RDV est marqué COMPLETED
    
    // Test cicatrisation - délais à partir de la completion
    const cicatrisationDelayMinutes = isProduction ? 7 * 24 * 60 : 10; // 7 jours vs 10 minutes
    const cicatrisationTime = new Date(completionTime.getTime() + cicatrisationDelayMinutes * 60 * 1000);
    
    // Test retouches - délais à partir de la completion
    let retouchesTime: Date;
    if (isProduction) {
      retouchesTime = new Date(completionTime.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 jours
    } else {
      retouchesTime = new Date(completionTime.getTime() + 15 * 60 * 1000); // 15 minutes
    }
    
    return {
      environment: isProduction ? 'PRODUCTION' : 'DÉVELOPPEMENT',
      cicatrisation: `${isProduction ? '7 jours' : '10 minutes'} après completion (${cicatrisationTime.toLocaleString()})`,
      retouches: `${isProduction ? '30 jours' : '15 minutes'} après completion (${retouchesTime.toLocaleString()})`
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
