import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { CacheService } from 'src/redis/cache.service';
import { Role, SaasPlan, VerificationStatusDocument } from '@prisma/client';
import { MailService } from 'src/email/mailer.service';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private cacheService: CacheService,
    private readonly mailService: MailService,
  ) {}

  //! ENVOYER UN EMAIL À UN CLIENT (admin)
  async sendEmailToClient({
    clientId,
    adminUserId,
    subject,
    message,
  }: {
    clientId: string;
    adminUserId?: string;
    subject: string;
    message: string;
  }): Promise<{ error: boolean; message: string }> {
    try {
      if (adminUserId && adminUserId === clientId) {
        return {
          error: true,
          message: 'Vous ne pouvez pas vous envoyer cet email via cette route.',
        };
      }

      const client = await this.prisma.user.findUnique({
        where: { id: clientId },
        select: {
          id: true,
          role: true,
          email: true,
          firstName: true,
          lastName: true,
        },
      });

      if (!client) {
        return {
          error: true,
          message: 'Utilisateur introuvable.',
        };
      }

      const recipientName = [client.firstName, client.lastName]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join(' ')
        .trim() || 'client';

      await this.mailService.sendAdminMessageToUser(
        client.email,
        subject,
        {
          recipientName,
          message,
        },
      );

      return {
        error: false,
        message: 'Email envoyé au client avec succès.',
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      console.error('Erreur lors de l\'envoi d\'email admin au client:', errorMessage);
      return {
        error: true,
        message: `Impossible d'envoyer l'email: ${errorMessage}`,
      };
    }
  }

  //! RÉCUPÉRER TOUS LES SALONS/TATOUEUR
  async getAllSalons(
    page: number = 1,
    limit: number = 10,
    search?: string,
    saasPlan?: SaasPlan,
    verifiedSalon?: boolean,
    role?: Role,
  ) {
    try {
      // Sanitize pagination
      const currentPage = Math.max(1, Number(page) || 1);
      const perPage = Math.min(100, Math.max(1, Number(limit) || 10));
      const skip = (currentPage - 1) * perPage;

      // Créer une clé de cache
      const cacheKey = `admin:salons:${JSON.stringify({
        page: currentPage,
        limit: perPage,
        search: search?.trim() || null,
        saasPlan: saasPlan || null,
        verifiedSalon: verifiedSalon ?? null,
        role: role || null,
      })}`;

      // 1. Vérifier dans Redis
      const cachedResult = await this.cacheService.get<{
        error: boolean;
        salons: any[];
        pagination: any;
      }>(cacheKey);

      if (cachedResult) {
        return cachedResult;
      }

      // 2. Construire les conditions de recherche
      const searchConditions = search
        ? {
            OR: [
              { salonName: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
              { city: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {};

      const whereClause = {
        role: role ?? { in: [Role.user, Role.user_salon, Role.user_tatoueur] },
        ...(saasPlan ? { saasPlan } : {}),
        ...(verifiedSalon !== undefined ? { verifiedSalon } : {}),
        ...searchConditions,
      };

      // 3. Compter le total
      const totalSalons = await this.prisma.user.count({ where: whereClause });

      // 4. Récupérer les salons avec pagination
      const salons = await this.prisma.user.findMany({
        where: whereClause,
        select: {
          id: true,
          role: true,
          email: true,
          firstName: true,
          lastName: true,
          salonName: true,
          phone: true,
          city: true,
          postalCode: true,
          image: true,
          description: true,
          verifiedSalon: true,
          SalonVerificationDocument: true,
          saasPlan: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: perPage,
      });

      const totalPages = Math.ceil(totalSalons / perPage);

      const result = {
        error: false,
        salons,
        pagination: {
          currentPage,
          limit: perPage,
          totalSalons,
          totalPages,
          hasNextPage: currentPage < totalPages,
          hasPreviousPage: currentPage > 1,
        },
      };

      // 5. Mettre en cache (TTL 10 minutes)
      await this.cacheService.set(cacheKey, result, 600);

      return result;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      console.error('Erreur lors de la récupération des salons:', errorMessage);
      return {
        error: true,
        message: 'Une erreur est survenue lors de la récupération des salons.',
      };
    }
  }

  //! RÉCUPÉRER TOUS LES CLIENTS (users avec role='client')
  async getAllClients(
    page: number = 1,
    limit: number = 10,
    search?: string
  ) {
    try {
      // Sanitize pagination
      const currentPage = Math.max(1, Number(page) || 1);
      const perPage = Math.min(100, Math.max(1, Number(limit) || 10));
      const skip = (currentPage - 1) * perPage;

      // Créer une clé de cache
      const cacheKey = `admin:clients:${JSON.stringify({
        page: currentPage,
        limit: perPage,
        search: search?.trim() || null
      })}`;

      // 1. Vérifier dans Redis
      const cachedResult = await this.cacheService.get<{
        error: boolean;
        clients: any[];
        pagination: any;
      }>(cacheKey);

      if (cachedResult) {
        return cachedResult;
      }

      // 2. Construire les conditions de recherche
      const searchConditions = search
        ? {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' as const } },
              { lastName: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {};

      const whereClause = {
        role: Role.client,
        ...searchConditions,
      };

      // 3. Compter le total
      const totalClients = await this.prisma.user.count({ where: whereClause });

      // 4. Récupérer les clients avec pagination
      const clients = await this.prisma.user.findMany({
        where: whereClause,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          image: true,
          clientProfile: {
            select: {
              pseudo: true,
              birthDate: true,
              city: true,
              postalCode: true,
            },
          },
          saasPlan: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: perPage,
      });

      const totalPages = Math.ceil(totalClients / perPage);

      const result = {
        error: false,
        clients,
        pagination: {
          currentPage,
          limit: perPage,
          totalClients,
          totalPages,
          hasNextPage: currentPage < totalPages,
          hasPreviousPage: currentPage > 1,
        },
      };

      // 5. Mettre en cache (TTL 10 minutes)
      await this.cacheService.set(cacheKey, result, 600);

      return result;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      console.error('Erreur lors de la récupération des clients:', errorMessage);
      return {
        error: true,
        message: 'Une erreur est survenue lors de la récupération des clients.',
      };
    }
  }

  //! RÉCUPÉRER LES SALONS AVEC DES DOCUMENTS EN ATTENTE (PENDING)
  async getSalonsWithPendingDocuments(
    page: number = 1,
    limit: number = 10,
    search?: string,
    saasPlan?: SaasPlan,
    verifiedSalon?: boolean
  ) {
    try {
      const currentPage = Math.max(1, Number(page) || 1);
      const perPage = Math.min(100, Math.max(1, Number(limit) || 10));
      const skip = (currentPage - 1) * perPage;

      const cacheKey = `admin:salons:pending:${JSON.stringify({
        page: currentPage,
        limit: perPage,
        search: search?.trim() || null,
        saasPlan: saasPlan || null,
        verifiedSalon: verifiedSalon !== undefined ? verifiedSalon : null,
      })}`;

      const cachedResult = await this.cacheService.get<{
        error: boolean;
        salons: any[];
        pagination: any;
      }>(cacheKey);

      if (cachedResult) {
        return cachedResult;
      }

      const searchConditions = search
        ? {
            OR: [
              { salonName: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
              { city: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {};

      const whereClause = {
        role: { in: [Role.user, Role.user_salon, Role.user_tatoueur] },
        ...(saasPlan ? { saasPlan } : {}),
        ...(verifiedSalon !== undefined ? { verifiedSalon } : {}),
        ...searchConditions,
        SalonVerificationDocument: {
          some: { status: VerificationStatusDocument.PENDING },
        },
      };

      const totalSalons = await this.prisma.user.count({ where: whereClause });

      const salons = await this.prisma.user.findMany({
        where: whereClause,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          salonName: true,
          phone: true,
          city: true,
          postalCode: true,
          image: true,
          verifiedSalon: true,
          SalonVerificationDocument: true,
          saasPlan: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: perPage,
      });

      const totalPages = Math.ceil(totalSalons / perPage);

      const result = {
        error: false,
        salons,
        pagination: {
          currentPage,
          limit: perPage,
          totalSalons,
          totalPages,
          hasNextPage: currentPage < totalPages,
          hasPreviousPage: currentPage > 1,
        },
      };

      await this.cacheService.set(cacheKey, result, 600);

      return result;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      console.error('Erreur lors de la récupération des salons avec documents en attente:', errorMessage);
      return {
        error: true,
        message: 'Une erreur est survenue lors de la récupération des salons avec documents en attente.',
      };
    }
  }
  //! RÉCUPÉRER UN UTILISATEUR PAR ID (admin)
  async getUserById(userId: string) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          salonName: true,
          salonHours: true,
          phone: true,
          address: true,
          city: true,
          postalCode: true,
          image: true,
          profileImage: true,
          description: true,
          verifiedSalon: true,
          saasPlan: true,
          createdAt: true,
          updatedAt: true,
          Tatoueur: {
            select: {
              id: true,
              name: true,
              hours: true,
              img: true,
              description: true,
              phone: true,
              instagram: true,
              skills: true,
              style: true,
              rdvBookingEnabled: true,
              createdAt: true,
              updatedAt: true,
            },
            orderBy: { createdAt: 'desc' },
          },
          clientProfile: {
            select: {
              pseudo: true,
              birthDate: true,
              city: true,
              postalCode: true,
            },
          },
          SalonVerificationDocument: {
            select: {
              id: true,
              type: true,
              status: true,
              fileUrl: true,
              rejectionReason: true,
              uploadedAt: true,
              reviewedAt: true,
            },
            orderBy: { uploadedAt: 'desc' },
          },
        },
      });

      if (!user) {
        return {
          error: true,
          message: 'Utilisateur introuvable.',
        };
      }

      return {
        error: false,
        user,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      console.error("Erreur lors de la récupération de l'utilisateur:", errorMessage);
      return {
        error: true,
        message: "Une erreur est survenue lors de la récupération de l'utilisateur.",
      };
    }
  }

  //! SUPPRIMER UN UTILISATEUR ET SES DONNÉES LIÉES (admin)
  async deleteUserAndDependencies(
    userId: string,
    adminUserId?: string,
  ): Promise<{ error: boolean; message: string }> {
    try {
      if (adminUserId && adminUserId === userId) {
        return {
          error: true,
          message: 'Vous ne pouvez pas supprimer votre propre compte admin.',
        };
      }

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          role: true,
        },
      });

      if (!user) {
        return {
          error: true,
          message: 'Utilisateur introuvable.',
        };
      }

      if (user.role === Role.admin) {
        return {
          error: true,
          message: 'La suppression d\'un compte administrateur est interdite.',
        };
      }

      await this.prisma.$transaction(async (tx) => {
        // Délier les tatoueurs users rattachés à ce salon, et profils clients liés.
        await tx.user.updateMany({ where: { salonId: userId }, data: { salonId: null } });
        await tx.client.updateMany({ where: { linkedUserId: userId }, data: { linkedUserId: null } });

        // Si l'utilisateur est référencé comme client connecté dans des RDV, on détache la référence.
        await tx.appointment.updateMany({ where: { clientUserId: userId }, data: { clientUserId: null } });

        // Nettoyage des ressources directement rattachées à l'utilisateur.
        await tx.favoriteUser.deleteMany({ where: { OR: [{ salonId: userId }, { clientId: userId }] } });
        await tx.favoritePortfolio.deleteMany({ where: { clientId: userId } });
        await tx.salonProfileView.deleteMany({ where: { salonId: userId } });
        await tx.notificationPreference.deleteMany({ where: { userId } });
        await tx.messageNotification.deleteMany({ where: { userId } });
        await tx.emailNotificationQueue.deleteMany({ where: { recipientUserId: userId } });
        await tx.message.deleteMany({ where: { senderId: userId } });
        await tx.conversation.deleteMany({ where: { OR: [{ salonId: userId }, { clientUserId: userId }] } });
        await tx.salonTatoueurTeamRequest.deleteMany({
          where: { OR: [{ salonId: userId }, { tatoueurUserId: userId }] },
        });
        await tx.salonVerificationDocument.deleteMany({ where: { userId } });
        await tx.clientProfile.deleteMany({ where: { userId } });
        await tx.saasPlanDetails.deleteMany({ where: { userId } });

        // Supprimer les jetons de sécurité liés à l'email du compte.
        await tx.verificationToken.deleteMany({ where: { email: user.email } });
        await tx.passwordResetToken.deleteMany({ where: { email: user.email } });

        // Suppression des données métier salon / tatoueur.
        const ownedTatoueurs = await tx.tatoueur.findMany({
          where: { userId },
          select: { id: true },
        });
        const ownedTatoueurIds = ownedTatoueurs.map((tatoueur) => tatoueur.id);

        if (ownedTatoueurIds.length > 0) {
          await tx.appointment.updateMany({
            where: { tatoueurId: { in: ownedTatoueurIds } },
            data: { tatoueurId: null },
          });
          await tx.blockedTimeSlot.updateMany({
            where: { tatoueurId: { in: ownedTatoueurIds } },
            data: { tatoueurId: null },
          });
        }

        // Nettoyage autour des demandes de RDV avant suppression.
        const appointmentRequests = await tx.appointmentRequest.findMany({
          where: { userId },
          select: { id: true },
        });
        const appointmentRequestIds = appointmentRequests.map((request) => request.id);

        if (appointmentRequestIds.length > 0) {
          await tx.proposedSlot.deleteMany({
            where: { appointmentRequestId: { in: appointmentRequestIds } },
          });
        }

        await tx.appointmentRequest.deleteMany({ where: { userId } });

        // Nettoyage des RDV où l'utilisateur est le salon propriétaire.
        const appointments = await tx.appointment.findMany({
          where: { userId },
          select: { id: true },
        });
        const appointmentIds = appointments.map((appointment) => appointment.id);

        if (appointmentIds.length > 0) {
          await tx.salonReview.deleteMany({ where: { appointmentId: { in: appointmentIds } } });
          await tx.followUpRequest.deleteMany({ where: { appointmentId: { in: appointmentIds } } });
          await tx.followUpSubmission.deleteMany({ where: { appointmentId: { in: appointmentIds } } });
          await tx.appointmentConsumable.deleteMany({ where: { appointmentId: { in: appointmentIds } } });
          await tx.rescheduleRequest.deleteMany({ where: { appointmentId: { in: appointmentIds } } });
          await tx.tattooDetail.deleteMany({ where: { appointmentId: { in: appointmentIds } } });
          await tx.timeSlot.deleteMany({ where: { appointmentId: { in: appointmentIds } } });
          await tx.conversation.deleteMany({ where: { appointmentId: { in: appointmentIds } } });
        }

        await tx.appointmentConsumable.deleteMany({ where: { userId } });
        await tx.followUpSubmission.deleteMany({ where: { userId } });
        await tx.followUpRequest.deleteMany({ where: { userId } });
        await tx.timeSlot.deleteMany({ where: { userId } });
        await tx.blockedTimeSlot.deleteMany({ where: { userId } });
        await tx.appointment.deleteMany({ where: { userId } });

        await tx.portfolio.deleteMany({ where: { userId } });
        await tx.flash.deleteMany({ where: { userId } });
        await tx.productSalon.deleteMany({ where: { userId } });
        await tx.stockItem.deleteMany({ where: { userId } });
        await tx.piercingServicePrice.deleteMany({ where: { userId } });
        await tx.piercingPrice.deleteMany({ where: { userId } });
        await tx.tatoueur.deleteMany({ where: { userId } });
        await tx.client.deleteMany({ where: { userId } });

        // Enfin, suppression du compte utilisateur.
        await tx.user.delete({ where: { id: userId } });
      });

      await this.cacheService.del(`user:${userId}`);
      await this.cacheService.delPattern('users:list:*');
      await this.cacheService.delPattern('user:slug:*');
      await this.cacheService.delPattern('user:photos:*');
      await this.cacheService.delPattern('portfolio:*');
      await this.cacheService.delPattern('flashs:*');
      await this.cacheService.delPattern('tatoueurs:*');
      await this.cacheService.delPattern('admin:*');

      return {
        error: false,
        message: 'Utilisateur et données associées supprimés avec succès.',
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      console.error('Erreur lors de la suppression utilisateur admin:', errorMessage);
      return {
        error: true,
        message: `Impossible de supprimer cet utilisateur: ${errorMessage}`,
      };
    }
  }

  //! RÉCUPÉRER LES STATISTIQUES DU DASHBOARD ADMIN
  async getAdminStats() {
    try {
      // Calculer le début du mois actuel
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      // Compter les salons (users avec role='user', 'user_salon' ou 'user_tatoueur')
      const totalSalons = await this.prisma.user.count({
        where: { role: { in: [Role.user, Role.user_salon, Role.user_tatoueur] } },
      });

      // Compter les clients (users avec role='client')
      const totalClients = await this.prisma.user.count({
        where: { role: Role.client },
      });

      // Compter les salons avec au moins un document en attente
      const salonsWithPendingDocuments = await this.prisma.user.count({
        where: {
          role: { in: [Role.user, Role.user_salon, Role.user_tatoueur] },
          SalonVerificationDocument: {
            some: { status: VerificationStatusDocument.PENDING },
          },
        },
      });

      // Compter les salons vérifiés
      const salonsVerified = await this.prisma.user.count({
        where: {
          role: { in: [Role.user, Role.user_salon, Role.user_tatoueur] },
          verifiedSalon: true,
        },
      });

      // Nouveaux salons inscrits ce mois
      const newSalonsThisMonth = await this.prisma.user.count({
        where: {
          role: { in: [Role.user, Role.user_salon, Role.user_tatoueur] },
          createdAt: { gte: startOfMonth },
        },
      });

      // Nouveaux clients inscrits ce mois
      const newClientsThisMonth = await this.prisma.user.count({
        where: {
          role: Role.client,
          createdAt: { gte: startOfMonth },
        },
      });

      // Total des tatoueurs
      const totalTatoueurs = await this.prisma.tatoueur.count();

      // Nombre total de rendez-vous
      const totalAppointments = await this.prisma.appointment.count();

      // Répartition des salons par plan SaaS
      const salonsBySaasPlan = await this.prisma.user.groupBy({
        by: ['saasPlan'],
        where: { role: { in: [Role.user, Role.user_salon, Role.user_tatoueur] } },
        _count: { saasPlan: true },
      });

      // Formater la répartition par plan
      const saasPlanStats = salonsBySaasPlan.reduce((acc, item) => {
        acc[item.saasPlan] = item._count.saasPlan;
        return acc;
      }, {} as Record<string, number>);

      return {
        error: false,
        stats: {
          totalSalons,
          totalClients,
          salonsWithPendingDocuments,
          salonsVerified,
          newSalonsThisMonth,
          newClientsThisMonth,
          totalTatoueurs,
          totalAppointments,
          salonsBySaasPlan: saasPlanStats,
        },
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      console.error('Erreur lors de la récupération des statistiques admin:', errorMessage);
      return {
        error: true,
        message: 'Une erreur est survenue lors de la récupération des statistiques.',
      };
    }
  }

  //! RÉCUPÉRER LES DONNÉES D'ÉVOLUTION MENSUELLE
  async getMonthlyEvolution(monthsCount: number = 6) {
    try {
      const now = new Date();
      const monthsData: Array<{
        month: string;
        salons: number;
        appointments: number;
        revenue: number;
      }> = [];

      // Noms des mois en français
      const monthNames = ['Janv', 'Fév', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];

      // Récupérer les données pour les N derniers mois
      for (let i = monthsCount - 1; i >= 0; i--) {
        const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const nextMonthDate = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);

        // Nouveaux salons inscrits ce mois
        const salons = await this.prisma.user.count({
          where: {
            role: { in: [Role.user, Role.user_salon, Role.user_tatoueur] },
            createdAt: {
              gte: monthDate,
              lt: nextMonthDate,
            },
          },
        });

        // Rendez-vous pris ce mois
        const appointments = await this.prisma.appointment.count({
          where: {
            createdAt: {
              gte: monthDate,
              lt: nextMonthDate,
            },
          },
        });

        // Calcul des revenus estimés basés sur les abonnements
        // NOTE: À adapter selon votre modèle de revenus réel
        const salonsPro = await this.prisma.user.count({
          where: {
            role: { in: [Role.user, Role.user_salon, Role.user_tatoueur] },
            saasPlan: SaasPlan.PRO,
            createdAt: { lte: nextMonthDate },
          },
        });

        const salonsBusiness = await this.prisma.user.count({
          where: {
            role: { in: [Role.user, Role.user_salon, Role.user_tatoueur] },
            saasPlan: SaasPlan.BUSINESS,
            createdAt: { lte: nextMonthDate },
          },
        });

        // Estimation: BUSINESS = 80€/mois, PRO = 40€/mois
        const revenue = (salonsBusiness * 80) + (salonsPro * 40);

        monthsData.push({
          month: monthNames[monthDate.getMonth()],
          salons,
          appointments,
          revenue,
        });
      }

      return {
        error: false,
        data: monthsData,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      console.error('Erreur lors de la récupération des données d\'évolution:', errorMessage);
      return {
        error: true,
        message: 'Une erreur est survenue lors de la récupération des données d\'évolution.',
      };
    }
  }
}
