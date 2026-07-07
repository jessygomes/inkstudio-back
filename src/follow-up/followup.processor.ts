// followup.processor.ts
import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { PrismaService } from 'src/database/prisma.service';
import { MailService } from 'src/email/mailer.service';
import { randomUUID } from 'crypto';
import { addDays } from 'date-fns';
import { Injectable, Logger } from '@nestjs/common';

@Processor('followup')
@Injectable()
export class FollowupProcessor {
  private readonly logger = new Logger(FollowupProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  // Consumer Bull: envoie le mail de suivi de cicatrisation.
  @Process('sendFollowupEmail')
  async handle(job: Job<{ appointmentId: string }>) {
    try {
      const { appointmentId } = job.data;
      
      this.logger.log(`🔄 Traitement du job de suivi pour le RDV: ${appointmentId}`);

      // 1) Charger le RDV + relations nécessaires pour construire l'email.
      const appt = await this.prisma.appointment.findUnique({
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
              email: true,
            },
          },
        },
      });

      // 2) Garde-fous: pas de RDV/client => rien à envoyer.
      if (!appt?.client) {
        this.logger.warn(`❌ Rendez-vous ou client introuvable pour l'ID: ${appointmentId}`);
        return;
      }

      // 3) Éligibilité métier: suivi autorisé uniquement quand le RDV est terminé.
      if (appt.status !== 'COMPLETED') {
        this.logger.log(`⏸️ Rendez-vous ${appointmentId} non éligible (statut: ${appt.status}), email de suivi non envoyé`);
        return;
      }

      // 4) Idempotence: si le client a déjà soumis un suivi, inutile de renvoyer.
      const existingReq = await this.prisma.followUpRequest.findUnique({
        where: { appointmentId },
        include: { 
          submission: true,
        },
      });

      if (existingReq?.submission) {
        this.logger.log(`✅ FollowUp déjà soumis pour le RDV ${appointmentId}, pas de nouvel email envoyé`);
        return;
      }

      // 5) Upsert de la demande de suivi (token réutilisable si déjà créé).
      const request = await this.prisma.followUpRequest.upsert({
        where: { appointmentId },
        update: {
          // Si existe déjà, on ne met rien à jour (garde le token existant)
        },
        create: {
          appointmentId,
          token: randomUUID(),
          expiresAt: addDays(appt.end ?? new Date(), 14), // Expire dans 14 jours
          userId: appt.userId, // Ajouter l'ID du salon
        },
      });

      // 6) Générer le lien frontend de soumission.
      const followUrl = `${process.env.WEB_URL}/suivi?f=${request.token}`;
      
      this.logger.log(`📧 Envoi de l'email de suivi à: ${appt.client.email}`);

      // 7) Envoi effectif de l'email de suivi.
      await this.mail.sendCicatrisationFollowUp(appt.client.email, {
        cicatrisationFollowUpDetails: {
          clientName: `${appt.client.firstName} ${appt.client.lastName}`,
          prestationName: appt.prestation,
          tatoueurName: appt.tatoueur?.name || 'notre tatoueur',
          followUpUrl: followUrl
        }
      }, appt.user?.salonName || undefined);

      // 8) Traçabilité: marquer la date d'envoi.
      await this.prisma.followUpRequest.update({
        where: { appointmentId },
        data: { sentAt: new Date() },
      });

      this.logger.log(`✅ Email de suivi envoyé avec succès pour le RDV ${appointmentId}`);
      
    } catch (error) {
      this.logger.error(`❌ Erreur lors du traitement du job de suivi:`, error);
      throw error; // Re-throw pour que Bull puisse retry
    }
  }

  // Consumer Bull: envoie le rappel retouches.
  @Process('sendRetouchesReminderEmail')
  async handleRetouches(job: Job<{ appointmentId: string }>) {
    try {
      const { appointmentId } = job.data;

      this.logger.log(`🔄 Traitement du job retouches pour le RDV: ${appointmentId}`);

      // 1) Charger le RDV + relations nécessaires.
      const appt = await this.prisma.appointment.findUnique({
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

      // 2) Garde-fous de base.
      if (!appt?.client) {
        this.logger.warn(`❌ Rendez-vous ou client introuvable pour le rappel retouches: ${appointmentId}`);
        return;
      }

      // 3) Éligibilité métier retouches: uniquement tattoo terminé.
      if (appt.prestation !== 'TATTOO' || appt.status !== 'COMPLETED') {
        this.logger.log(`⏸️ RDV ${appointmentId} non éligible au rappel retouches (prestation=${appt.prestation}, statut=${appt.status})`);
        return;
      }

      // 4) Envoi de l'email de rappel retouches.
      await this.mail.sendRetouchesReminder(
        appt.client.email,
        {
          recipientName: `${appt.client.firstName} ${appt.client.lastName}`,
          retouchesReminderDetails: {
            clientName: `${appt.client.firstName} ${appt.client.lastName}`,
            appointmentDate: appt.start.toLocaleDateString('fr-FR', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            }),
            tatoueurName: appt.tatoueur?.name || 'Non assigné',
            salonName: appt.user?.salonName || 'Notre salon',
          },
        },
        appt.user?.salonName || undefined,
      );

      // 5) Log de succès.
      this.logger.log(`✅ Email de rappel retouches envoyé pour le RDV ${appointmentId}`);
    } catch (error) {
      this.logger.error('❌ Erreur lors du traitement du job retouches:', error);
      throw error;
    }
  }
}
