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

  @Process('sendFollowupEmail')
  async handle(job: Job<{ appointmentId: string }>) {
    try {
      const { appointmentId } = job.data;
      
      this.logger.log(`🔄 Traitement du job de suivi pour le RDV: ${appointmentId}`);

      // Récupérer le rendez-vous avec toutes les relations nécessaires
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

      if (!appt?.client) {
        this.logger.warn(`❌ Rendez-vous ou client introuvable pour l'ID: ${appointmentId}`);
        return;
      }

      // Vérifier que le rendez-vous est confirmé
      if (appt.status !== 'CONFIRMED') {
        this.logger.log(`⏸️ Rendez-vous ${appointmentId} non confirmé (statut: ${appt.status}), email de suivi non envoyé`);
        return;
      }

      // Vérifier si un suivi a déjà été soumis (idempotence)
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

      // Créer ou mettre à jour la demande de suivi
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

      // Construire l'URL de suivi
      const followUrl = `${process.env.WEB_URL}/suivi?f=${request.token}`;
      
      this.logger.log(`📧 Envoi de l'email de suivi à: ${appt.client.email}`);

      // Envoyer l'email de suivi de cicatrisation
      await this.mail.sendCicatrisationFollowUp(appt.client.email, {
        cicatrisationFollowUpDetails: {
          clientName: `${appt.client.firstName} ${appt.client.lastName}`,
          prestationName: appt.prestation,
          tatoueurName: appt.tatoueur?.name || 'notre tatoueur',
          followUpUrl: followUrl
        }
      }, appt.user?.salonName || undefined);

      // Marquer l'email comme envoyé
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
}
