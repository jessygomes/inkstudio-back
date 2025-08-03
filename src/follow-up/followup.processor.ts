/* eslint-disable prettier/prettier */
// followup.processor.ts
import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { PrismaService } from 'src/database/prisma.service';
import { MailService } from 'src/mailer.service';
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

      // Envoyer l'email de suivi
      await this.mail.sendMail({
        to: appt.client.email,
        subject: 'Suivi de cicatrisation — Envoyez votre photo',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #333;">Bonjour ${appt.client.firstName} ${appt.client.lastName},</h2>
            
            <p>Merci pour votre visite chez ${appt.user?.salonName || 'notre salon'} !</p>
            
            <p>Votre ${appt.prestation.toLowerCase()} avec ${appt.tatoueur?.name || 'notre tatoueur'} s'est bien déroulé.</p>
            
            <p><strong>Pour assurer un suivi optimal de votre cicatrisation, nous aimerions avoir de vos nouvelles :</strong></p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${followUrl}" 
                style="background-color: #007bff; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
                📸 Envoyer ma photo et mon avis
              </a>
            </div>
            
            <p style="color: #666; font-size: 14px;">
              <strong>Important :</strong> Ce lien est valable pendant 14 jours. 
              Votre photo nous aidera à vérifier que la cicatrisation se déroule bien.
            </p>
            
            <p style="color: #666; font-size: 12px; margin-top: 30px;">
              Si vous avez des questions ou des préoccupations, n'hésitez pas à nous contacter directement.
            </p>
          </div>
        `,
      });

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
