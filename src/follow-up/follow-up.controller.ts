import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { MailService } from 'src/mailer.service';

@Controller('follow-up')
export class FollowupsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService
  ) {}

  /**
   * 🔍 VALIDATION DU TOKEN DE SUIVI
   * Vérifie si un lien de suivi est valide, non expiré et non déjà utilisé
   * Route: GET /follow-up/requests/:token
   */
  @Get('requests/:token')
  async validateToken(@Param('token') token: string) {
    try {
      // 🔎 Chercher la demande de suivi avec ce token
      const req = await this.prisma.followUpRequest.findUnique({
        where: { token },
        include: { submission: true, appointment: true },
      });
      
      // ❌ Token introuvable
      if (!req) {
        throw new BadRequestException('Lien invalide');
      }
      
      // ❌ Déjà soumis par le client
      if (req.submission) {
        throw new BadRequestException('Déjà soumis');
      }
      
      // ❌ Lien expiré (14 jours max)
      if (req.expiresAt && req.expiresAt < new Date()) {
        throw new BadRequestException('Lien expiré');
      }
      
      // ✅ Token valide
      return { ok: true };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Erreur lors de la validation du token');
    }
  }

  /**
   * 📸 SOUMISSION DU SUIVI CLIENT
   * Le client envoie sa photo, note et avis après cicatrisation
   * Route: POST /follow-up/submissions
   * Body: { token, rating, review?, photoUrl }
   */
  @Post('submissions')
  async submit(
    @Body() body: { token: string; rating: number; review?: string; photoUrl: string; userId?: string; isPhotoPublic?: boolean; },
  ) {
    // 🔎 Vérifier que le token existe et récupérer les infos du RDV
    const req = await this.prisma.followUpRequest.findUnique({ 
      where: { token: body.token }, 
      include: { appointment: true, submission: true }
    });
    
    // ❌ Token invalide
    if (!req) throw new BadRequestException('Token invalide');
    
    // ❌ Déjà soumis par le client
    if (req.submission) {
      throw new BadRequestException('Ce suivi a déjà été soumis');
    }
    
    // ❌ Lien expiré (14 jours maximum)
    if (req.expiresAt && req.expiresAt < new Date()) {
      throw new BadRequestException('Lien expiré');
    }

    // 💾 Créer la soumission avec photo + avis client
    const submission = await this.prisma.followUpSubmission.create({
      data: {
        appointmentId: req.appointmentId,
        clientId: req.appointment?.clientId ?? null, // Associer au client si disponible
        rating: body.rating,      // Note de 1 à 5
        review: body.review,      // Commentaire optionnel
        photoUrl: body.photoUrl,  // URL de la photo de cicatrisation
        isPhotoPublic: body.isPhotoPublic ?? false, // Indiquer si la photo est publique
        userId: req.appointment?.userId || '', // Associer au salon
      },
    });

    // ✅ Marquer la demande comme soumise et lier la soumission
    await this.prisma.followUpRequest.update({
      where: { token: body.token },
      data: { 
        status: 'SUBMITTED',
        submissionId: submission.id
      },
    });

    // 🎉 Succès - Le suivi est maintenant complet
    return { ok: true };
  }

  //! RECUPERER LES SUIVIS PAS ENCORE REPONDU PAR LE SALON
  @Get('unanswered/:userId')
  async getUnansweredFollowUps(userId: string) {
    const followUps = await this.prisma.followUpSubmission.findMany({
      where: { isAnswered: false, userId },
      include: { appointment: {
        select: {
          id: true,
          title: true,
          start: true,
          end: true,
          client: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
          tatoueur: {
            select: {
              id: true,
              name: true,
            },
          },
        }
      }},
    });
    return { followUps };
  }

    //! RECUPERER LE NOMBRE DE SUIVIS PAS ENCORE REPONDU PAR LE SALON
  @Get('unanswered/:userId/number')
  async getUnansweredNumberFollowUps(@Param('userId') userId: string) {
    const count = await this.prisma.followUpSubmission.count({
      where: { isAnswered: false, userId },
    });
    return { count };
  }

  //! RECUPERER TOUS LES SUIVI D'UN SALON
  @Get('all/:userId')
  async getAllFollowUps(@Param('userId') userId: string) {
    const followUps = await this.prisma.followUpSubmission.findMany({
      where: { userId },
      include: {
        appointment: {
          select: {
            id: true,
            title: true,
            start: true,
            end: true,
            client: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
            tatoueur: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' }, // Trier par date de création
      take: 100, // Limiter à 100 derniers suivis
    });

    return { followUps };
  }

  //! REPONDRE A UN SUIVI
  @Post('reply/:id')
  async replyToFollowUp(
    @Param('id') id: string,
    @Body() body: { response: string }
  ) {
    // Vérifier si le suivi existe
    const followUp = await this.prisma.followUpSubmission.findUnique({
      where: { id },
      include: { 
        appointment: {
          include: {
            client: true,
            tatoueur: {
              select: { name: true }
            },
            user: {
              select: { salonName: true }
            }
          }
        }
      },
    });
    
    if (!followUp) {
      throw new BadRequestException('Suivi non trouvé');
    }
    if (followUp.isAnswered) {
      throw new BadRequestException('Ce suivi a déjà été répondu');
    }
    if (!followUp.appointment) {
      throw new BadRequestException('Rendez-vous associé introuvable');
    }
    if (!followUp.appointment.client) {
      throw new BadRequestException('Client associé introuvable');
    }

    // Mettre à jour le suivi avec la réponse du salon
    const updatedFollowUp = await this.prisma.followUpSubmission.update({
      where: { id },
      data: {
        response: body.response,
        isAnswered: true, // Marquer comme répondu
      },
    });

    // 📧 Envoyer l'email de réponse au client
    const client = followUp.appointment.client;
    const salon = followUp.appointment.user?.salonName || 'Notre salon';
    const tatoueur = followUp.appointment.tatoueur?.name || 'notre artiste';
    
    await this.mailService.sendMail({
      to: client.email,
      subject: `Réponse à votre suivi de cicatrisation - ${salon}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333;">Bonjour ${client.firstName} ${client.lastName},</h2>
          
          <p>Merci pour votre photo et votre avis concernant votre ${followUp.appointment.prestation.toLowerCase()} réalisé par ${tatoueur} !</p>
          
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #007bff; margin-top: 0;">💬 Notre réponse :</h3>
            <p style="font-size: 16px; line-height: 1.6; margin-bottom: 0;">${body.response}</p>
          </div>
          
          <p>Nous espérons que ces informations vous seront utiles. N'hésitez pas à nous contacter si vous avez d'autres questions.</p>
          
          <p style="margin-top: 30px;">
            Cordialement,<br>
            <strong>L'équipe de ${salon}</strong>
          </p>
          
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
          <p style="color: #666; font-size: 12px; text-align: center;">
            Cet email est une réponse à votre suivi de cicatrisation.<br>
            Si vous n'avez pas envoyé de suivi, veuillez nous contacter.
          </p>
        </div>
      `,
    });

    // Optionnel : mettre à jour le statut de la demande de suivi
    // await this.prisma.followUpRequest.update({
    //   where: { appointmentId: followUp.appointment.id },
    //   data: { status: 'ANSWERED' },
    // });
    
    return { 
      success: true,
      message: 'Réponse envoyée avec succès',
      updatedFollowUp 
    };
  }

  //! SUPPRIMER UN SUIVI
  @Post('delete/:id')
  async deleteFollowUp(@Param('id') id: string) {
    // Vérifier si le suivi existe
    const followUp = await this.prisma.followUpSubmission.findUnique({
      where: { id },
    });
    if (!followUp) {
      throw new BadRequestException('Suivi non trouvé');
    }

    console.log('Deleting follow-up:', followUp);

    try {
      // D'abord, supprimer la relation dans FollowUpRequest si elle existe
      const relatedRequest = await this.prisma.followUpRequest.findFirst({
        where: { submissionId: id }
      });

      if (relatedRequest) {
        // Mettre à jour la FollowUpRequest pour enlever la relation avant de supprimer la soumission
        await this.prisma.followUpRequest.update({
          where: { id: relatedRequest.id },
          data: { submissionId: null }
        });
      }

      // Ensuite, supprimer la soumission
      await this.prisma.followUpSubmission.delete({
        where: { id },
      });

      // Optionnellement, supprimer complètement la FollowUpRequest si plus nécessaire
      if (relatedRequest) {
        await this.prisma.followUpRequest.delete({
          where: { id: relatedRequest.id }
        });
      }

      return { success: true, message: 'Suivi supprimé avec succès' };
      
    } catch (error) {
      console.error('Erreur lors de la suppression du suivi:', error);
      throw new BadRequestException('Erreur lors de la suppression du suivi');
    }
  }
}
