/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { BadRequestException, Body, Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { RequestWithUser } from 'src/auth/jwt.strategy';
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
  @UseGuards(JwtAuthGuard)
  @Get('unanswered')
  async getUnansweredFollowUps(@Request() req: RequestWithUser) {
    const userId = req.user.userId;
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
  @UseGuards(JwtAuthGuard)
  @Get('all')
  async getAllFollowUps(
    @Request() req: RequestWithUser,
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Query('status') status?: 'all' | 'answered' | 'unanswered',
    @Query('tatoueurId') tatoueurId?: string,
    @Query('q') q?: string,
  ) {
    const userId = req.user.userId;
    const currentPage = Math.max(1, Number(page) || 1);
    const perPage = Math.min(50, Math.max(1, Number(limit) || 10));
    const skip = (currentPage - 1) * perPage;

    // where
    const where: Record<string, unknown> = { userId };

    if (status && status !== 'all') {
      where.isAnswered = status === 'answered';
    }
    if (tatoueurId && tatoueurId !== 'all') {
      // relation filter via appointment
      where.appointment = { ...(typeof where.appointment === 'object' && where.appointment !== null ? where.appointment : {}), tatoueurId };
    }
    if (q && q.trim() !== '') {
      const query = q.trim();
      // Match prénom/nom (insensible à la casse)
      where.OR = [
        { appointment: { client: { firstName: { contains: query, mode: 'insensitive' } } } },
        { appointment: { client: { lastName:  { contains: query, mode: 'insensitive' } } } },
      ];
    }

    const [total, followUps] = await this.prisma.$transaction([
      this.prisma.followUpSubmission.count({ where }),
      this.prisma.followUpSubmission.findMany({
        where,
        include: {
          appointment: {
            select: {
              id: true, title: true, start: true, end: true,
              client: { select: { id: true, firstName: true, lastName: true } },
              tatoueur: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: perPage,
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const startIndex = total === 0 ? 0 : skip + 1;
    const endIndex = Math.min(skip + perPage, total);

    return {
      error: false,
      followUps,
      pagination: {
        currentPage,
        limit: perPage,
        totalFollowUps: total,
        totalPages,
        hasNextPage: currentPage < totalPages,
        hasPreviousPage: currentPage > 1,
        startIndex,
        endIndex,
      },
    };
  }

  //! REPONDRE A UN SUIVI
  @UseGuards(JwtAuthGuard)
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
    
    await this.mailService.sendFollowUpResponse(client.email, {
      followUpResponseDetails: {
        clientName: `${client.firstName} ${client.lastName}`,
        tatoueurName: tatoueur,
        prestationName: followUp.appointment.prestation,
        response: body.response
      }
    }, salon);

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
