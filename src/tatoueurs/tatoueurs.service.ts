import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { CreateTatoueurDto } from './dto/create-tatoueur.dto';
import { SaasService } from 'src/saas/saas.service';
import { CacheService } from 'src/redis/cache.service';
import { Role, TeamRequestStatus } from '@prisma/client';
import { CreateTeamRequestDto } from './dto/create-team-request.dto';

@Injectable()
export class TatoueursService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly saasService: SaasService,
    private cacheService: CacheService
  ) {}

  //! CREER UN TATOUEUR
  async create({ tatoueurBody, userId }: {tatoueurBody: CreateTatoueurDto, userId: string}) {
    try {
      const { name, img, description, phone, instagram, hours, style, skills } = tatoueurBody;

      // 🔒 VÉRIFIER LES LIMITES SAAS - TATOUEURS
      const canCreateTatoueur = await this.saasService.canPerformAction(userId, 'tatoueur');
      
      if (!canCreateTatoueur) {
        const limits = await this.saasService.checkLimits(userId);
        return {
          error: true,
          message: `Limite de tatoueurs atteinte (${limits.limits.tattooeurs}). Passez au plan PRO ou BUSINESS pour continuer.`,
        };
      }

      // Créer le tatoueur
      const newTatoueur = await this.prisma.tatoueur.create({
        data: {
          name,
          img,
          description,
          phone,
          instagram,
          hours,
          userId,
          style,
          skills,
        },
      });

      // Invalider le cache après création
      await this.cacheService.del(`tatoueurs:all`);
      await this.cacheService.del(`tatoueurs:user:${userId}`);
      await this.cacheService.del(`tatoueurs:user:${userId}:appointment-enabled`);

      return {
        error: false,
        message: 'Tatoueur créé avec succès.',
        tatoueur: newTatoueur,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! RECHERCHER DES TATOUEURS USERS INSCRITS (pour invitation d'equipe)
  async searchTatoueurUsers({
    salonUserId,
    salonRole,
    query,
  }: {
    salonUserId: string;
    salonRole?: string;
    query?: string;
  }) {
    try {
      if (salonRole !== 'user_salon' && salonRole !== 'user') {
        return {
          error: true,
          message: 'Seuls les salons peuvent rechercher des tatoueurs inscrits.',
        };
      }

      const trimmedQuery = query?.trim();

      const users = await this.prisma.user.findMany({
        where: {
          role: Role.user_tatoueur,
          OR: trimmedQuery
            ? [
                { firstName: { contains: trimmedQuery, mode: 'insensitive' } },
                { lastName: { contains: trimmedQuery, mode: 'insensitive' } },
                { email: { contains: trimmedQuery, mode: 'insensitive' } },
              ]
            : undefined,
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          image: true,
          phone: true,
          instagram: true,
          salonId: true,
          receivedTeamRequests: {
            where: {
              salonId: salonUserId,
              status: TeamRequestStatus.PENDING,
            },
            select: {
              id: true,
            },
            take: 1,
          },
        },
        take: 30,
        orderBy: { createdAt: 'desc' },
      });

      const tatoueurs = users.map((user) => ({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        image: user.image,
        phone: user.phone,
        instagram: user.instagram,
        isAlreadyInTeam: user.salonId === salonUserId,
        hasPendingRequestFromThisSalon: user.receivedTeamRequests.length > 0,
      }));

      return {
        error: false,
        tatoueurs,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! ENVOYER UNE DEMANDE D'INTEGRATION A UN TATOUEUR USER
  async createTeamRequest({
    salonUserId,
    salonRole,
    body,
  }: {
    salonUserId: string;
    salonRole?: string;
    body: CreateTeamRequestDto;
  }) {
    try {
      if (salonRole !== 'user_salon' && salonRole !== 'user') {
        return {
          error: true,
          message: 'Seuls les salons peuvent envoyer une demande.',
        };
      }

      const { tatoueurUserId, message } = body;

      const tatoueurUser = await this.prisma.user.findUnique({
        where: { id: tatoueurUserId },
        select: {
          id: true,
          role: true,
          salonId: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      });

      if (!tatoueurUser || tatoueurUser.role !== Role.user_tatoueur) {
        return {
          error: true,
          message: 'Tatoueur introuvable ou invalide.',
        };
      }

      if (tatoueurUser.salonId === salonUserId) {
        return {
          error: true,
          message: 'Ce tatoueur fait déjà partie de votre équipe.',
        };
      }

      const existingPending = await this.prisma.salonTatoueurTeamRequest.findFirst({
        where: {
          salonId: salonUserId,
          tatoueurUserId,
          status: TeamRequestStatus.PENDING,
        },
        select: { id: true },
      });

      if (existingPending) {
        return {
          error: true,
          message: 'Une demande est déjà en attente pour ce tatoueur.',
        };
      }

      const request = await this.prisma.salonTatoueurTeamRequest.create({
        data: {
          salonId: salonUserId,
          tatoueurUserId,
          message,
          status: TeamRequestStatus.PENDING,
        },
        select: {
          id: true,
          status: true,
          createdAt: true,
          tatoueurUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      return {
        error: false,
        message: 'Demande envoyée avec succès.',
        request,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! LISTE DES DEMANDES ENVOYEES PAR LE SALON
  async getOutgoingTeamRequests({
    salonUserId,
    salonRole,
  }: {
    salonUserId: string;
    salonRole?: string;
  }) {
    try {
      if (salonRole !== 'user_salon' && salonRole !== 'user') {
        return {
          error: true,
          message: 'Seuls les salons peuvent voir les demandes envoyées.',
        };
      }

      const requests = await this.prisma.salonTatoueurTeamRequest.findMany({
        where: { salonId: salonUserId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          message: true,
          status: true,
          createdAt: true,
          respondedAt: true,
          tatoueurUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              image: true,
            },
          },
        },
      });

      return {
        error: false,
        requests,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! LISTE DES DEMANDES REÇUES PAR LE TATOUEUR USER
  async getIncomingTeamRequests({
    tatoueurUserId,
    tatoueurRole,
  }: {
    tatoueurUserId: string;
    tatoueurRole?: string;
  }) {
    try {
      if (tatoueurRole !== 'user_tatoueur') {
        return {
          error: true,
          message: 'Seuls les tatoueurs peuvent voir les demandes reçues.',
        };
      }

      const requests = await this.prisma.salonTatoueurTeamRequest.findMany({
        where: {
          tatoueurUserId,
          status: TeamRequestStatus.PENDING,
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          message: true,
          status: true,
          createdAt: true,
          salon: {
            select: {
              id: true,
              salonName: true,
              firstName: true,
              lastName: true,
              image: true,
            },
          },
        },
      });

      return {
        error: false,
        requests,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! REPONDRE A UNE DEMANDE D'INTEGRATION
  async respondToTeamRequest({
    requestId,
    tatoueurUserId,
    tatoueurRole,
    action,
  }: {
    requestId: string;
    tatoueurUserId: string;
    tatoueurRole?: string;
    action: 'accept' | 'refuse';
  }) {
    try {
      if (tatoueurRole !== 'user_tatoueur') {
        return {
          error: true,
          message: 'Seuls les tatoueurs peuvent répondre à une demande.',
        };
      }

      const request = await this.prisma.salonTatoueurTeamRequest.findUnique({
        where: { id: requestId },
        include: {
          salon: {
            select: {
              id: true,
              salonName: true,
            },
          },
          tatoueurUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true,
              image: true,
              instagram: true,
              description: true,
            },
          },
        },
      });

      if (!request || request.tatoueurUserId !== tatoueurUserId) {
        return {
          error: true,
          message: 'Demande introuvable.',
        };
      }

      if (request.status !== TeamRequestStatus.PENDING) {
        return {
          error: true,
          message: 'Cette demande a déjà été traitée.',
        };
      }

      const nextStatus = action === 'accept' ? TeamRequestStatus.ACCEPTED : TeamRequestStatus.REFUSED;

      const result = await this.prisma.$transaction(async (tx) => {
        const updatedRequest = await tx.salonTatoueurTeamRequest.update({
          where: { id: requestId },
          data: {
            status: nextStatus,
            respondedAt: new Date(),
          },
        });

        if (nextStatus === TeamRequestStatus.ACCEPTED) {
          await tx.user.update({
            where: { id: tatoueurUserId },
            data: { salonId: request.salonId },
          });

          // Créer une entrée dans la table Tatoueur pour affichage dans l'équipe du salon.
          const fullName = `${request.tatoueurUser.firstName ?? ''} ${request.tatoueurUser.lastName ?? ''}`.trim();
          const displayName = fullName || 'Tatoueur';

          const existingTeamEntry = await tx.tatoueur.findFirst({
            where: {
              userId: request.salonId,
              name: displayName,
              phone: request.tatoueurUser.phone ?? undefined,
            },
            select: { id: true },
          });

          if (!existingTeamEntry) {
            await tx.tatoueur.create({
              data: {
                userId: request.salonId,
                name: displayName,
                img: request.tatoueurUser.image ?? undefined,
                description: request.tatoueurUser.description ?? undefined,
                phone: request.tatoueurUser.phone ?? undefined,
                instagram: request.tatoueurUser.instagram ?? undefined,
                hours: undefined,
                style: [],
                skills: [],
              },
            });
          }
        }

        return updatedRequest;
      });

      return {
        error: false,
        message: nextStatus === TeamRequestStatus.ACCEPTED
          ? 'Demande acceptée, vous apparaissez maintenant dans l\'équipe du salon.'
          : 'Demande refusée.',
        request: {
          id: result.id,
          status: result.status,
          respondedAt: result.respondedAt,
        },
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! VOIR TOUS LES TATOUEURS
  async getAllTatoueurs() {
    try {
      const cacheKey = `tatoueurs:all`;

      // 1. Vérifier dans Redis
      const cachedTatoueurs = await this.cacheService.get<{
        id: string;
        name: string;
        img: string;
        description: string;
        [key: string]: any;
      }[]>(cacheKey);
      
      if (cachedTatoueurs) {
        return cachedTatoueurs;
      }

      // 2. Sinon, aller chercher en DB
      const tatoueurs = await this.prisma.tatoueur.findMany();

      // 3. Mettre en cache (TTL 30 minutes pour tous les tatoueurs)
      await this.cacheService.set(cacheKey, tatoueurs, 1800);

      return tatoueurs;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      }; 
    }
  }

  //! VOIR TOUS LES TATOUEURS PAR USER ID
  async getTatoueurByUserId(userId: string) {
    try {
      const cacheKey = `tatoueurs:user:${userId}`;

      // 1. Vérifier dans Redis
      const cachedTatoueurs = await this.cacheService.get<{
        id: string;
        name: string;
        img: string;
        description: string;
        [key: string]: any;
      }[]>(cacheKey);
      
      if (cachedTatoueurs) {
        return cachedTatoueurs;
      }

      // 2. Sinon, aller chercher en DB
      const tatoueurs = await this.prisma.tatoueur.findMany({
        where: {
          userId,
        },
      });

      // 3. Mettre en cache (TTL 20 minutes pour les tatoueurs d'un salon)
      await this.cacheService.set(cacheKey, tatoueurs, 1200);

      return tatoueurs;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

    //! VOIR TOUS LES TATOUEURS QUI PEUVENT PRENDRE DES RDV PAR USER ID
  async getTatoueurByUserIdForAppointment(userId: string) {
    try {
      const cacheKey = `tatoueurs:user:${userId}:appointment-enabled`;

      // 1. Vérifier dans Redis
      const cachedTatoueurs = await this.cacheService.get<{
        id: string;
        name: string;
        img: string;
        description: string;
        rdvBookingEnabled: boolean;
        [key: string]: any;
      }[]>(cacheKey);
      
      if (cachedTatoueurs) {
        return cachedTatoueurs;
      }

      // 2. Sinon, aller chercher en DB
      const tatoueurs = await this.prisma.tatoueur.findMany({
        where: {
          userId,
          rdvBookingEnabled: true
        },
      });

      // 3. Mettre en cache (TTL 15 minutes pour les tatoueurs RDV-enabled)
      await this.cacheService.set(cacheKey, tatoueurs, 900);

      return tatoueurs;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! VOIR UN SEUL TATOUEUR
  async getOneTatoueur(id: string) {
    try {
      const cacheKey = `tatoueur:${id}`;

      // 1. Vérifier dans Redis
      const cachedTatoueur = await this.cacheService.get<{
        id: string;
        name: string;
        img: string;
        description: string;
        [key: string]: any;
      }>(cacheKey);
      
      if (cachedTatoueur) {
        return cachedTatoueur;
      }

      // 2. Sinon, aller chercher en DB
      const tatoueur = await this.prisma.tatoueur.findUnique({
        where: {
          id,
        },
      });

      // 3. Mettre en cache si trouvé (TTL 30 minutes pour un tatoueur spécifique)
      if (tatoueur) {
        await this.cacheService.set(cacheKey, tatoueur, 1800);
      }

      return tatoueur;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! MODIFIER UN TATOUEUR
  async updateTatoueur(id: string, tatoueurBody: CreateTatoueurDto) {
    try {
      const { name, img, description, phone, instagram, hours, style, skills, rdvBookingEnabled } = tatoueurBody;

      const updatedTatoueur = await this.prisma.tatoueur.update({
        where: {
          id,
        },
        data: {
          name,
          img,
          description,
          phone,
          instagram,
          hours,
          style,
          skills,
          rdvBookingEnabled
        },
      });

      // Invalider le cache après mise à jour
      await this.cacheService.del(`tatoueur:${id}`);
      await this.cacheService.del(`tatoueurs:all`);
      await this.cacheService.del(`tatoueurs:user:${updatedTatoueur.userId}`);
      await this.cacheService.del(`tatoueurs:user:${updatedTatoueur.userId}:appointment-enabled`);

      return {
        error: false,
        message: 'Tatoueur modifié avec succès.',
        tatoueur: updatedTatoueur,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! SUPPRIMER UN TATOUEUR
  async deleteTatoueur(id: string) {
    try {
      const deletedTatoueur = await this.prisma.tatoueur.delete({
        where: {
          id,
        },
      });

      // Invalider le cache après suppression
      await this.cacheService.del(`tatoueur:${id}`);
      await this.cacheService.del(`tatoueurs:all`);
      await this.cacheService.del(`tatoueurs:user:${deletedTatoueur.userId}`);
      await this.cacheService.del(`tatoueurs:user:${deletedTatoueur.userId}:appointment-enabled`);

      return {
        error: false,
        message: 'Tatoueur supprimé avec succès.',
        tatoueur: deletedTatoueur,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }
}
