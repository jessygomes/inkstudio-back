import { getActivityChart, type ActivityChartQuery } from './activity-chart';
import { getActivityStats, type ActivityQuery } from './activity-stats';
import { getMembershipDuration } from './account-membership';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { CacheService } from 'src/redis/cache.service';
import { PublicVisibility, Role, SaasPlan, VerificationStatusDocument } from '@prisma/client';
import { MailService } from 'src/email/mailer.service';
import { findClosestStyle, styleKey } from 'src/portfolio/style.utils';

@Injectable()
export class AdminService {
  getActivityChart(query: ActivityChartQuery) {
    return getActivityChart(this.prisma, query);
  }

  getActivityStats(query: ActivityQuery) {
    return getActivityStats(this.prisma, query);
  }

  async updatePublicVisibility(id: string, publicVisibility: PublicVisibility) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { role: true } });
    if (!user) throw new NotFoundException('Compte introuvable.');
    if (!['user_salon', 'user_tatoueur', 'user'].includes(user.role)) {
      throw new BadRequestException('Ce compte ne possède pas de profil professionnel.');
    }
    const updated = await this.prisma.user.update({ where: { id }, data: { publicVisibility }, select: { id: true, publicVisibility: true } });
    await Promise.all(['admin:*', 'users:list:*', 'user:slug:*', 'portfolio:inspirations:*', 'user:*', 'tatoueurs:*', 'client:appointments:*'].map((pattern) => this.cacheService.delPattern(pattern)));
    return { error: false, user: updated };
  }
  async getProjectReports(page: number) {
    const [data, total] = await Promise.all([
      this.prisma.professionalReport.findMany({ skip: (page - 1) * 20, take: 20, orderBy: { createdAt: 'desc' }, include: {
        client: { select: { id: true, email: true, firstName: true, lastName: true } },
        professional: { select: { id: true, salonName: true, nickname: true, publicVisibility: true, email: true } },
        proposal: { select: { message: true, moodboard: { select: { name: true } } } },
      } }), this.prisma.professionalReport.count(),
    ]);
    return { data, total, page, totalPages: Math.ceil(total / 20) };
  }
  constructor(
    private prisma: PrismaService,
    private cacheService: CacheService,
    private readonly mailService: MailService,
  ) {}

  private withMembership<T extends { createdAt?: string | Date }>(user: T) {
    return user.createdAt ? { ...user, membership: getMembershipDuration(user.createdAt) } : user;
  }

  private styleError(error: unknown) {
    const code = typeof error === 'object' && error ? (error as { code?: string }).code : undefined;
    if (code === 'P2002') return { error: true, message: 'Ce style existe déjà.' };
    if (code === 'P2025') return { error: true, message: 'Style introuvable.' };
    return { error: true, message: 'Impossible d’enregistrer la modification du style. Réessayez.' };
  }

  private slugify(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private categoryError(error: unknown) {
    if (typeof error === 'object' && error && (error as { code?: string }).code === 'P2002') {
      return { error: true, message: 'Une catégorie avec ce slug existe déjà.' };
    }
    if (typeof error === 'object' && error && (error as { code?: string }).code === 'P2025') {
      return { error: true, message: 'Catégorie introuvable.' };
    }
    return { error: true, message: error instanceof Error ? error.message : 'Erreur inconnue' };
  }

  //! LISTER LES STYLES AVEC LEUR NOMBRE D'UTILISATIONS (admin)
  async getStyles() {
    const [styles, usage] = await Promise.all([
      this.prisma.style.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.$queryRaw<{ name: string; count: bigint }[]>`
        SELECT s AS name, count(*) AS count FROM "Portfolio", unnest("style") AS s GROUP BY s`,
    ]);
    const countByName = new Map(usage.map((u) => [u.name, Number(u.count)]));
    return {
      error: false,
      styles: styles.map((s) => ({ ...s, photoCount: countByName.get(s.name) ?? 0 })),
    };
  }

  //! CRÉER UN STYLE (admin) - refusé s'il existe déjà ou s'il est quasi identique à un existant
  async createStyle(rawName: string) {
    try {
      const name = rawName.trim().toUpperCase();
      const key = styleKey(name);
      if (!key) {
        return { error: true, message: 'Nom de style invalide.' };
      }
      const known = await this.prisma.style.findMany({ select: { name: true, key: true } });
      const closest = findClosestStyle(key, known);
      if (closest) {
        return { error: true, message: `Ce style existe déjà ou est trop proche de « ${closest.name} ».` };
      }
      const style = await this.prisma.style.create({ data: { name, key } });
      await this.cacheService.delPattern('portfolio:*');
      return { error: false, message: 'Style créé', style };
    } catch (error) { return this.styleError(error); }
  }

  //! RENOMMER UN STYLE (admin) - répercuté sur toutes les photos
  async updateStyle(id: string, rawName: string) {
    try {
      const existing = await this.prisma.style.findUnique({ where: { id } });
      if (!existing) {
        return { error: true, message: 'Style introuvable.' };
      }
      const name = rawName.trim().toUpperCase();
      const key = styleKey(name);
      if (!key) {
        return { error: true, message: 'Nom de style invalide.' };
      }
      const others = await this.prisma.style.findMany({
        where: { id: { not: id } },
        select: { name: true, key: true },
      });
      const closest = findClosestStyle(key, others);
      if (closest) {
        return { error: true, message: `Ce nom existe déjà ou est trop proche de « ${closest.name} ».` };
      }

      const [style] = await this.prisma.$transaction([
        this.prisma.style.update({ where: { id }, data: { name, key } }),
        this.prisma.$executeRaw`
          UPDATE "Portfolio" SET "style" = array_replace("style", ${existing.name}, ${name})
          WHERE ${existing.name} = ANY("style")`,
      ]);
      await this.cacheService.delPattern('portfolio:*');
      return { error: false, message: 'Style mis à jour', style };
    } catch (error) { return this.styleError(error); }
  }

  //! SUPPRIMER UN STYLE (admin) - retiré de toutes les photos
  async deleteStyle(id: string) {
    try {
      const existing = await this.prisma.style.findUnique({ where: { id } });
      if (!existing) {
        return { error: true, message: 'Style introuvable.' };
      }
      await this.prisma.$transaction([
        this.prisma.$executeRaw`
          UPDATE "Portfolio" SET "style" = array_remove("style", ${existing.name})
          WHERE ${existing.name} = ANY("style")`,
        this.prisma.style.delete({ where: { id } }),
      ]);
      await this.cacheService.delPattern('portfolio:*');
      return { error: false, message: 'Style supprimé' };
    } catch (error) { return this.styleError(error); }
  }

  //! LISTER LES CATÉGORIES DE TATOUAGE (admin)
  async getTattooCategories() {
    const categories = await this.prisma.tattooCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { portfolios: true } } },
    });
    return { error: false, categories };
  }

  //! CRÉER UNE CATÉGORIE DE TATOUAGE (admin)
  async createTattooCategory(data: { name: string; slug?: string; sortOrder?: number; isActive?: boolean }) {
    const name = data.name.trim();
    const slug = this.slugify(data.slug?.trim() || name);
    if (!name || !slug) {
      return { error: true, message: 'Nom de catégorie invalide.' };
    }
    try {
      const category = await this.prisma.tattooCategory.create({
        data: { name, slug, sortOrder: data.sortOrder ?? 0, isActive: data.isActive ?? true },
      });
      await this.cacheService.delPattern('portfolio:*');
      return { error: false, message: 'Catégorie créée', category };
    } catch (error) {
      return this.categoryError(error);
    }
  }

  //! MODIFIER UNE CATÉGORIE DE TATOUAGE (admin)
  async updateTattooCategory(
    id: string,
    data: { name?: string; slug?: string; sortOrder?: number; isActive?: boolean },
  ) {
    const name = data.name?.trim();
    const slug = data.slug !== undefined ? this.slugify(data.slug) : undefined;
    if ((data.name !== undefined && !name) || (data.slug !== undefined && !slug)) {
      return { error: true, message: 'Nom ou slug invalide.' };
    }
    try {
      const category = await this.prisma.tattooCategory.update({
        where: { id },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(slug !== undefined ? { slug } : {}),
          ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        },
      });
      await this.cacheService.delPattern('portfolio:*');
      return { error: false, message: 'Catégorie mise à jour', category };
    } catch (error) {
      return this.categoryError(error);
    }
  }

  //! SUPPRIMER UNE CATÉGORIE DE TATOUAGE (admin) - la retire des photos associées
  async deleteTattooCategory(id: string) {
    try {
      await this.prisma.tattooCategory.delete({ where: { id } });
      await this.cacheService.delPattern('portfolio:*');
      return { error: false, message: 'Catégorie supprimée' };
    } catch (error) {
      return this.categoryError(error);
    }
  }

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
        return { ...cachedResult, salons: cachedResult.salons.map(user => this.withMembership(user)) };
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
          salonName: true, nickname: true, publicVisibility: true,
          phone: true,
          city: true,
          postalCode: true,
          image: true,
          description: true,
          verifiedSalon: true,
          SalonVerificationDocument: true,
          saasPlan: true,
          redeemedInvitation: { select: { id: true, durationMonths: true, redeemedAt: true } },
          saasPlanDetails: {
            select: { firstPaidPlanAt: true, currentPlan: true, planStatus: true },
          },
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
        salons: salons.map(user => this.withMembership(user)),
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
        return { ...cachedResult, clients: cachedResult.clients.map(user => this.withMembership(user)) };
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
          saasPlanDetails: {
            select: { firstPaidPlanAt: true, currentPlan: true, planStatus: true },
          },
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
        clients: clients.map(user => this.withMembership(user)),
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
          salonName: true, nickname: true, publicVisibility: true,
          phone: true,
          city: true,
          postalCode: true,
          image: true,
          verifiedSalon: true,
          SalonVerificationDocument: true,
          saasPlan: true,
          saasPlanDetails: {
            select: { firstPaidPlanAt: true, currentPlan: true, planStatus: true },
          },
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
        salons: salons.map(user => this.withMembership(user)),
        pagination: {
          currentPage,
          limit: perPage,
          totalSalons,
          totalPages,
          hasNextPage: currentPage < totalPages,
          hasPreviousPage: currentPage > 1,
        },
      };



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
          salonName: true, nickname: true, publicVisibility: true,
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
          saasPlanUntil: true,
          stripeSubscriptionId: true,
          redeemedInvitation: { select: { id: true, durationMonths: true, redeemedAt: true } },
          saasPlanDetails: {
            select: { firstPaidPlanAt: true, currentPlan: true, planStatus: true, startDate: true, endDate: true, trialEndDate: true, paymentMethod: true, monthlyPrice: true, nextPaymentDate: true },
          },
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
        user: this.withMembership({ ...user, hasStripeSubscription: !!user.stripeSubscriptionId }),
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

        // Keep only anonymous counts, atomically with the actual deletion.
        if (([Role.user, Role.user_salon, Role.user_tatoueur] as Role[]).includes(user.role)) {
          await tx.accountDeparture.create({ data: { role: user.role, source: 'ADMIN_DELETION' } });
        }
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
      const count = Number.isFinite(monthsCount) ? Math.min(24, Math.max(1, Math.trunc(monthsCount))) : 6;
      const now = new Date();
      const paris = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit' }).formatToParts(now);
      const year = Number(paris.find(part => part.type === 'year')!.value);
      const month = Number(paris.find(part => part.type === 'month')!.value) - 1;
      const tracking = await this.prisma.adminMetricTracking.findUnique({ where: { key: 'account-departures' } });
      const professionalRoles = [Role.user, Role.user_salon, Role.user_tatoueur];
      // Civil months in Paris, independently of the deployment server timezone.
      const boundary = (yearValue: number, monthValue: number) => {
        const date = new Date(Date.UTC(yearValue, monthValue, 1));
        const offset = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Paris', timeZoneName: 'longOffset' }).formatToParts(date).find(part => part.type === 'timeZoneName')!.value;
        const match = offset.match(/GMT([+-])(\d{2}):(\d{2})/);
        const minutes = match ? (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '+' ? 1 : -1) : 0;
        return new Date(date.getTime() - minutes * 60000);
      };
      const data = await Promise.all(Array.from({ length: count }, async (_, index) => {
        const calendar = new Date(Date.UTC(year, month - count + 1 + index, 1));
        const from = boundary(year, month - count + 1 + index);
        const to = boundary(year, month - count + 2 + index);
        const departureFrom = tracking && tracking.startedAt > from ? tracking.startedAt : from;
        const [salons, appointments, departures] = await Promise.all([
          this.prisma.user.count({ where: { role: { in: professionalRoles }, createdAt: { gte: from, lt: to } } }),
          this.prisma.appointment.count({ where: { createdAt: { gte: from, lt: to } } }),
          tracking && to > tracking.startedAt
            ? this.prisma.accountDeparture.count({ where: { role: { in: professionalRoles }, occurredAt: { gte: departureFrom, lt: to } } })
            : Promise.resolve(null),
        ]);
        return {
          period: calendar.toISOString().slice(0, 7),
          month: new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' }).format(calendar),
          salons, appointments, departures,
          departuresTrackingSince: tracking?.startedAt.toISOString() ?? null,
        };
      }));
      return { error: false, data };
    } catch (error: unknown) {
      console.error('Erreur statistiques mensuelles:', error instanceof Error ? error.message : 'unknown');
      return { error: true, message: "Impossible de récupérer les données d’évolution." };
    }
  }
}
