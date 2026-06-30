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

  private normalizeStyles(styleInput: unknown): string[] {
    return Array.isArray(styleInput)
      ? [
          ...new Set(
            styleInput
              .filter((item): item is string => typeof item === 'string')
              .map((item) => item.trim().toUpperCase())
              .filter(Boolean),
          ),
        ]
      : [];
  }

  //! CREER UN TATOUEUR
  async create({ tatoueurBody, userId }: {tatoueurBody: CreateTatoueurDto, userId: string}) {
    try {
      const { name, img, description, phone, instagram, hours, style, skills } = tatoueurBody;
      const normalizedStyles = this.normalizeStyles(style);

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
          style: normalizedStyles,
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
          salonName: true,
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
        salonName: user.salonName,
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
          salonName: true,
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
              salonName: true,
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
              salonName: true,
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
              profileImage: true,
              address: true,
              city: true,
              postalCode: true,
              instagram: true,
              website: true,
              salonHours: true,
              prestations: true,
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

  //! LISTE DES SALONS RELIES AU TATOUEUR USER (actuel + historiques acceptes)
  async getLinkedSalons({
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
          message: 'Seuls les tatoueurs peuvent voir les salons liés.',
        };
      }

      const tatoueurUser = await this.prisma.user.findUnique({
        where: { id: tatoueurUserId },
        select: {
          salonId: true,
          salon: {
            select: {
              id: true,
              salonName: true,
              profileImage: true,
              address: true,
              city: true,
              postalCode: true,
              instagram: true,
              website: true,
              salonHours: true,
              prestations: true,
              image: true,
            },
          },
        },
      });

      const acceptedRequests = await this.prisma.salonTatoueurTeamRequest.findMany({
        where: {
          tatoueurUserId,
          status: TeamRequestStatus.ACCEPTED,
        },
        orderBy: { respondedAt: 'desc' },
        select: {
          respondedAt: true,
          createdAt: true,
          salon: {
            select: {
              id: true,
              salonName: true,
              profileImage: true,
              address: true,
              city: true,
              postalCode: true,
              instagram: true,
              website: true,
              salonHours: true,
              prestations: true,
              image: true,
            },
          },
        },
      });

      const salonsMap = new Map<string, {
        id: string;
        salonName: string | null;
        profileImage: string | null;
        address: string | null;
        adress: string | null;
        city: string | null;
        postalCode: string | null;
        instagram: string | null;
        website: string | null;
        salonHours: string | null;
        prestations: string[];
        image: string | null;
        isCurrentSalon: boolean;
        linkedAt: Date | null;
      }>();

      // Historique des rattachements acceptes
      for (const item of acceptedRequests) {
        const salon = item.salon;
        if (!salonsMap.has(salon.id)) {
          salonsMap.set(salon.id, {
            id: salon.id,
            salonName: salon.salonName,
            profileImage: salon.profileImage,
            address: salon.address,
            adress: salon.address,
            city: salon.city,
            postalCode: salon.postalCode,
            instagram: salon.instagram,
            website: salon.website,
            salonHours: salon.salonHours,
            prestations: salon.prestations,
            image: salon.image,
            isCurrentSalon: tatoueurUser?.salonId === salon.id,
            linkedAt: item.respondedAt ?? item.createdAt,
          });
        }
      }

      // S'assurer que le salon actuellement rattaché apparait toujours
      if (tatoueurUser?.salon && !salonsMap.has(tatoueurUser.salon.id)) {
        salonsMap.set(tatoueurUser.salon.id, {
          id: tatoueurUser.salon.id,
          salonName: tatoueurUser.salon.salonName,
          profileImage: tatoueurUser.salon.profileImage,
          address: tatoueurUser.salon.address,
          adress: tatoueurUser.salon.address,
          city: tatoueurUser.salon.city,
          postalCode: tatoueurUser.salon.postalCode,
          instagram: tatoueurUser.salon.instagram,
          website: tatoueurUser.salon.website,
          salonHours: tatoueurUser.salon.salonHours,
          prestations: tatoueurUser.salon.prestations,
          image: tatoueurUser.salon.image,
          isCurrentSalon: true,
          linkedAt: null,
        });
      }

      const salons = Array.from(salonsMap.values()).sort((a, b) => {
        if (a.isCurrentSalon && !b.isCurrentSalon) return -1;
        if (!a.isCurrentSalon && b.isCurrentSalon) return 1;
        const aTs = a.linkedAt ? a.linkedAt.getTime() : 0;
        const bTs = b.linkedAt ? b.linkedAt.getTime() : 0;
        return bTs - aTs;
      });

      return {
        error: false,
        salons,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  /**
   * Gère l'acceptation/refus d'une demande d'intégration d'équipe salon
   * 
   * FLUX D'ACCEPTATION :
   * 1. Valide que le tatoueur a fourni les deux permissions obligatoires
   * 2. Lie le tatoueur au salon (update User.salonId)
   * 3. Persiste les permissions choisies lors de l'acceptance :
   *    - User.salonCanViewAppointments : autorise le salon à voir agenda/RDV
   *    - User.salonCanCreateAppointments : autorise le salon à créer des RDV
   * 4. Invalide les caches de tatoueurs et RDV du salon
   * 
   * FLUX DE REFUS :
   * 1. Marque simplement la demande comme REFUSED
   * 2. Aucun changement sur les données utilisateur
   * 
   * @param {Object} params
   * @param {string} params.requestId ID de la demande
   * @param {string} params.tatoueurUserId ID du tatoueur qui répond
   * @param {string} params.tatoueurRole Rôle du tatoueur (doit être user_tatoueur)
   * @param {'accept'|'refuse'} params.action Action à effectuer
   * @param {boolean} params.allowSalonAgendaAccess Permission 1 (obligatoire si accept)
   * @param {boolean} params.allowSalonCreateAppointments Permission 2 (obligatoire si accept)
   * 
   * @returns {Object} { error, message, request { id, status, permissions } }
   */
  async respondToTeamRequest({
    requestId,
    tatoueurUserId,
    tatoueurRole,
    action,
    allowSalonAgendaAccess,
    allowSalonCreateAppointments,
  }: {
    requestId: string;
    tatoueurUserId: string;
    tatoueurRole?: string;
    action: 'accept' | 'refuse';
    allowSalonAgendaAccess?: boolean;
    allowSalonCreateAppointments?: boolean;
  }) {
    try {
      if (tatoueurRole !== Role.user_tatoueur) {
        return {
          error: true,
          message: 'Seul un tatoueur peut répondre à cette demande.',
        };
      }

      const request = await this.prisma.salonTatoueurTeamRequest.findUnique({
        where: { id: requestId },
        include: {
          salon: {
            select: {
              id: true,
              salonName: true,
              email: true,
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

      // À l'acceptation, les deux permissions sont OBLIGATOIRES
      if (
        action === 'accept'
        && (typeof allowSalonAgendaAccess !== 'boolean' || typeof allowSalonCreateAppointments !== 'boolean')
      ) {
        return {
          error: true,
          message:
            'Veuillez préciser les autorisations du salon (accès agenda/RDV et création de RDV) avant d\'accepter.',
        };
      }

      const result = await this.prisma.$transaction(async (tx) => {
        // Évite les conflits de contrainte unique (salonId, tatoueurUserId, status)
        // Supprime les anciennes demandes au même statut si elles existent
        await tx.salonTatoueurTeamRequest.deleteMany({
          where: {
            salonId: request.salonId,
            tatoueurUserId,
            status: nextStatus,
            id: { not: requestId },
          },
        });

        // Met à jour le statut de la demande
        const updatedRequest = await tx.salonTatoueurTeamRequest.update({
          where: { id: requestId },
          data: {
            status: nextStatus,
            respondedAt: new Date(),
          },
        });

        // À l'acceptation : lie le tatoueur au salon ET persiste les permissions
        if (nextStatus === TeamRequestStatus.ACCEPTED) {
          await tx.user.update({
            where: { id: tatoueurUserId },
            data: {
              salonId: request.salonId,
              // Permission 1 : Autorise le salon à voir l'agenda/RDV du tatoueur
              salonCanViewAppointments: !!allowSalonAgendaAccess,
              // Permission 2 : Autorise le salon à créer des RDV pour ce tatoueur
              salonCanCreateAppointments: !!allowSalonCreateAppointments,
            },
          });
        }

        return updatedRequest;
      });

      // Invalide les caches du salon pour forcer la mise à jour des tatoueurs liés
      await this.cacheService.del(`tatoueurs:user:${request.salonId}`);
      await this.cacheService.del(`tatoueurs:user:${request.salonId}:appointment-enabled`);

      return {
        error: false,
        message: nextStatus === TeamRequestStatus.ACCEPTED
          ? 'Demande acceptée, vous apparaissez maintenant dans l\'équipe du salon.'
          : 'Demande refusée.',
        request: {
          id: result.id,
          status: result.status,
          respondedAt: result.respondedAt,
          // Retourne les permissions acceptées
          permissions: nextStatus === TeamRequestStatus.ACCEPTED
            ? {
                allowSalonAgendaAccess: !!allowSalonAgendaAccess,
                allowSalonCreateAppointments: !!allowSalonCreateAppointments,
              }
            : undefined,
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

  //! Récupérer ses valeurs de permissions actuelles
  async getCurrentPermissions({
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
          message: 'Seuls les tatoueurs peuvent voir leurs permissions.',
        };
      }

      const tatoueur = await this.prisma.user.findUnique({
        where: { id: tatoueurUserId },
        select: {
          salonCanViewAppointments: true,
          salonCanCreateAppointments: true,
        },
      });

      if (!tatoueur) {
        return {
          error: true,
          message: 'Tatoueur introuvable.',
        };
      }

      return {
        error: false,
        permissions: {
          allowSalonAgendaAccess: tatoueur.salonCanViewAppointments,
          allowSalonCreateAppointments: tatoueur.salonCanCreateAppointments,
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

  /**
   *! Toggle pour le tatoueur lié : autoriser/refuser que le salon voit son agenda/RDV
   * 
   * Logique :
   * 1. Vérifie que l'appelant est un user_tatoueur
   * 2. Récupère le tatoueur et vérifie qu'il est lié à un salon
   * 3. Met à jour User.salonCanViewAppointments selon le paramètre 'enabled'
   * 4. Invalide les caches de RDV du salon (pattern: appointments:salon:*)
   * 
   * @param {Object} params
   * @param {string} params.tatoueurUserId ID du tatoueur qui toggle
   * @param {string} params.tatoueurRole Rôle de l'utilisateur (doit être user_tatoueur)
   * @param {boolean} params.enabled true = autoriser, false = refuser
   * 
   * @returns {Object} { error, message, permissions { allowSalonAgendaAccess } }
   */
  async updateSalonAgendaAccessPermission({
    tatoueurUserId,
    tatoueurRole,
    enabled,
  }: {
    tatoueurUserId: string;
    tatoueurRole?: string;
    enabled: boolean;
  }) {
    try {
      // Seul un user_tatoueur peut modifier ses permissions
      if (tatoueurRole !== 'user_tatoueur') {
        return {
          error: true,
          message: 'Seuls les tatoueurs peuvent gérer cet accès.',
        };
      }

      // Récupère le tatoueur et ses permissions actuelles
      const linkedTatoueur = await this.prisma.user.findUnique({
        where: { id: tatoueurUserId },
        select: {
          id: true,
          role: true,
          salonId: true,
          salonCanViewAppointments: true,
        },
      });

      if (!linkedTatoueur || linkedTatoueur.role !== Role.user_tatoueur) {
        return {
          error: true,
          message: 'Tatoueur introuvable ou invalide.',
        };
      }

      // Un tatoueur DOIT être lié à un salon pour gérer ses permissions
      if (!linkedTatoueur.salonId) {
        return {
          error: true,
          message: 'Aucun salon lié actuellement.',
        };
      }

      // Met à jour la permission
      await this.prisma.user.update({
        where: { id: tatoueurUserId },
        data: { salonCanViewAppointments: enabled },
      });

      // Invalide les caches de RDV et tatoueurs du salon lié
      await Promise.all([
        this.cacheService.del(`tatoueurs:user:${linkedTatoueur.salonId}`),
        this.cacheService.del(`tatoueurs:user:${linkedTatoueur.salonId}:appointment-enabled`),
        // Invalide TOUS les caches de RDV du salon pour forcer un refresh
        this.cacheService.delPattern(`appointments:salon:${linkedTatoueur.salonId}:*`),
        this.cacheService.delPattern(`appointments:date-range:${linkedTatoueur.salonId}:*`),
        // Invalide les données du tatoueur
        this.cacheService.del(`user:${tatoueurUserId}`),
      ]);

      return {
        error: false,
        message: enabled
          ? 'Le salon peut maintenant voir votre agenda et vos rendez-vous.'
          : 'Le salon ne peut plus voir votre agenda ni vos rendez-vous.',
        permissions: {
          allowSalonAgendaAccess: enabled,
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

  /**
   * Toggle pour le tatoueur lié : autoriser/refuser que le salon crée des RDV pour lui
   * 
   * Logique :
   * 1. Vérifie que l'appelant est un user_tatoueur
   * 2. Récupère le tatoueur et vérifie qu'il est lié à un salon
   * 3. Met à jour User.salonCanCreateAppointments selon le paramètre 'enabled'
   * 4. Invalide le cache de gestion des tatoueurs du salon
   * 
   * Note : Ce champ est séparé de 'appointmentBookingEnabled' qui gère l'agenda du tatoueur
   * (GLOBAL vs PAR_TATOUEUR). salonCanCreateAppointments gère spécifiquement l'autorisation
   * pour le user_salon lié de créer des RDV pour ce tatoueur lié.
   * 
   * @param {Object} params
   * @param {string} params.tatoueurUserId ID du tatoueur qui toggle
   * @param {string} params.tatoueurRole Rôle de l'utilisateur (doit être user_tatoueur)
   * @param {boolean} params.enabled true = autoriser, false = refuser
   * 
   * @returns {Object} { error, message, permissions { allowSalonCreateAppointments } }
   */
  async updateSalonAppointmentCreationPermission({
    tatoueurUserId,
    tatoueurRole,
    enabled,
  }: {
    tatoueurUserId: string;
    tatoueurRole?: string;
    enabled: boolean;
  }) {
    try {
      // Seul un user_tatoueur peut modifier ses permissions
      if (tatoueurRole !== 'user_tatoueur') {
        return {
          error: true,
          message: 'Seuls les tatoueurs peuvent gérer cet accès.',
        };
      }

      // Récupère le tatoueur et ses permissions actuelles
      const linkedTatoueur = await this.prisma.user.findUnique({
        where: { id: tatoueurUserId },
        select: {
          id: true,
          role: true,
          salonId: true,
          salonCanCreateAppointments: true,
        },
      });

      if (!linkedTatoueur || linkedTatoueur.role !== Role.user_tatoueur) {
        return {
          error: true,
          message: 'Tatoueur introuvable ou invalide.',
        };
      }

      // Un tatoueur DOIT être lié à un salon pour gérer ses permissions
      if (!linkedTatoueur.salonId) {
        return {
          error: true,
          message: 'Aucun salon lié actuellement.',
        };
      }

      // Met à jour la permission
      await this.prisma.user.update({
        where: { id: tatoueurUserId },
        data: { salonCanCreateAppointments: enabled },
      });

      // Invalide le cache de gestion des tatoueurs du salon
      await Promise.all([
        this.cacheService.del(`tatoueurs:user:${linkedTatoueur.salonId}`),
        this.cacheService.del(`tatoueurs:user:${linkedTatoueur.salonId}:appointment-enabled`),
        this.cacheService.del(`user:${tatoueurUserId}`),
      ]);

      return {
        error: false,
        message: enabled
          ? 'Le salon peut maintenant créer des rendez-vous pour vous.'
          : 'Le salon ne peut plus créer de rendez-vous pour vous.',
        permissions: {
          allowSalonCreateAppointments: enabled,
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
      const cacheKey = `tatoueurs:user:${userId}:v2-salon-name`;

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
      const tatoueursInternes = await this.prisma.tatoueur.findMany({
        where: {
          userId,
        },
      });

      type LinkedTatoueurUser = {
        id: string;
        firstName: string | null;
        lastName: string | null;
        image: string | null;
        profileImage: string | null;
        phone: string | null;
        instagram: string | null;
        salonName: string | null;
        description: string | null;
        prestations: string[];
        style: string[];
        appointmentBookingEnabled: boolean;
      };

      // 2b. Ajouter les tatoueurs users rattachés au salon (profil en lecture seule)
      const linkedTatoueurUsersResult = await this.prisma.user.findMany({
        where: {
          salonId: userId,
          role: Role.user_tatoueur,
        },
        select: {
          id: true,
          salonName: true,
          firstName: true,
          lastName: true,
          image: true,
          profileImage: true,
          phone: true,
          instagram: true,
          description: true,
          prestations: true,
          style: true,
          appointmentBookingEnabled: true,
        },
      });

      const linkedTatoueurUsers = linkedTatoueurUsersResult as unknown as LinkedTatoueurUser[];

      const linkedTatoueurs = linkedTatoueurUsers.map((user) => {
        const displayName = user.salonName?.trim() || 'Tatoueur';

        return {
          id: `linked_${user.id}`,
          linkedUserId: user.id,
          name: displayName,
          img: user.profileImage ?? user.image,
          description: user.description,
          phone: user.phone,
          instagram: user.instagram,
          hours: null,
          style: user.style,
          skills: user.prestations,
          rdvBookingEnabled: user.appointmentBookingEnabled,
          salonName: user.salonName,
          isLinkedUser: true,
          isReadOnly: true,
        };
      });

      const tatoueurs = [
        ...tatoueursInternes.map((tatoueur) => ({
          ...tatoueur,
          isLinkedUser: false,
          isReadOnly: false,
        })),
        ...linkedTatoueurs,
      ];

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
      const cacheKey = `tatoueurs:user:${userId}:appointment-enabled:v2-salon-name`;

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
      const [tatoueursInternes, linkedTatoueurUsersResult] = await Promise.all([
        this.prisma.tatoueur.findMany({
          where: {
            userId,
            rdvBookingEnabled: true,
          },
        }),
        this.prisma.user.findMany({
          where: {
            salonId: userId,
            role: Role.user_tatoueur,
            appointmentBookingEnabled: true,
          },
          select: {
            id: true,
            salonName: true,
            firstName: true,
            lastName: true,
            image: true,
            profileImage: true,
            phone: true,
            instagram: true,
            description: true,
            prestations: true,
            style: true,
            appointmentBookingEnabled: true,
          },
        }),
      ]);

      type LinkedTatoueurUser = {
        id: string;
        salonName: string | null;
        firstName: string | null;
        lastName: string | null;
        image: string | null;
        profileImage: string | null;
        phone: string | null;
        instagram: string | null;
        description: string | null;
        prestations: string[];
        style: string[];
        appointmentBookingEnabled: boolean;
      };

      const linkedTatoueurUsers = linkedTatoueurUsersResult as unknown as LinkedTatoueurUser[];

      const linkedTatoueurs = linkedTatoueurUsers.map((user) => {
        const displayName = user.salonName?.trim() || 'Tatoueur';

        return {
          id: `linked_${user.id}`,
          linkedUserId: user.id,
          name: displayName,
          img: user.profileImage ?? user.image,
          description: user.description,
          phone: user.phone,
          instagram: user.instagram,
          hours: null,
          style: user.style,
          skills: user.prestations,
          rdvBookingEnabled: user.appointmentBookingEnabled,
          salonName: user.salonName,
          isLinkedUser: true,
          isReadOnly: true,
        };
      });

      const tatoueurs = [
        ...tatoueursInternes.map((tatoueur) => ({
          ...tatoueur,
          isLinkedUser: false,
          isReadOnly: false,
        })),
        ...linkedTatoueurs,
      ];

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

  //! AUTORISER OU NON UN TATOUEUR RELIE A PRENDRE DES RDV
  async updateLinkedTatoueurAppointmentBooking({
    salonUserId,
    salonRole,
    tatoueurUserId,
    appointmentBookingEnabled,
  }: {
    salonUserId: string;
    salonRole?: string;
    tatoueurUserId: string;
    appointmentBookingEnabled: boolean;
  }) {
    try {
      if (salonRole !== 'user_salon' && salonRole !== 'user') {
        return {
          error: true,
          message: 'Seuls les salons peuvent gérer la prise de RDV d\'un tatoueur lié.',
        };
      }

      const linkedTatoueur = await this.prisma.user.findUnique({
        where: { id: tatoueurUserId },
        select: {
          id: true,
          role: true,
          salonId: true,
          appointmentBookingEnabled: true,
          salonCanCreateAppointments: true,
        },
      });

      if (!linkedTatoueur || linkedTatoueur.role !== Role.user_tatoueur) {
        return {
          error: true,
          message: 'Tatoueur introuvable ou invalide.',
        };
      }

      if (linkedTatoueur.salonId !== salonUserId) {
        return {
          error: true,
          message: 'Ce tatoueur n\'est pas lié à votre salon.',
        };
      }

      if (appointmentBookingEnabled === true && linkedTatoueur?.salonCanCreateAppointments !== true) {
        return {
          error: true,
          message:
            "Ce tatoueur n'a pas autorisé votre salon à créer des RDV pour lui.",
        };
      }

      const updatedTatoueur = await this.prisma.user.update({
        where: { id: tatoueurUserId },
        data: {
          appointmentBookingEnabled,
        },
        select: {
          id: true,
          appointmentBookingEnabled: true,
          salonId: true,
          salonCanCreateAppointments: true,
        },
      });

      await Promise.all([
        this.cacheService.del(`tatoueurs:user:${salonUserId}`),
        this.cacheService.del(`tatoueurs:user:${salonUserId}:appointment-enabled`),
        this.cacheService.del(`user:${salonUserId}`),
        this.cacheService.delPattern('user:slug:*'),
        this.cacheService.del(`user:${tatoueurUserId}`),
      ]);

      return {
        error: false,
        message: appointmentBookingEnabled
          ? 'La prise de RDV a été activée pour ce tatoueur.'
          : 'La prise de RDV a été désactivée pour ce tatoueur.',
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
  
  //! RETIRER UN TATOUEUR RELIE D'UN SALON
  async unlinkLinkedTatoueur({
    salonUserId,
    salonRole,
    tatoueurUserId,
  }: {
    salonUserId: string;
    salonRole?: string;
    tatoueurUserId: string;
  }) {
    try {
      if (salonRole !== 'user_salon' && salonRole !== 'user') {
        return {
          error: true,
          message: 'Seuls les salons peuvent retirer un tatoueur lié.',
        };
      }

      const linkedTatoueur = await this.prisma.user.findUnique({
        where: { id: tatoueurUserId },
        select: {
          id: true,
          role: true,
          salonId: true,
        },
      });

      if (!linkedTatoueur || linkedTatoueur.role !== Role.user_tatoueur) {
        return {
          error: true,
          message: 'Tatoueur introuvable ou invalide.',
        };
      }

      if (linkedTatoueur.salonId !== salonUserId) {
        return {
          error: true,
          message: 'Ce tatoueur n\'est pas lié à votre salon.',
        };
      }

      await this.prisma.user.update({
        where: { id: tatoueurUserId },
        data: { salonId: null },
      });

      // Nettoie l'ancien état ACCEPTED pour permettre une future ré-acceptation
      // du même duo salon/tatoueur sans conflit de contrainte unique.
      await this.prisma.salonTatoueurTeamRequest.deleteMany({
        where: {
          salonId: salonUserId,
          tatoueurUserId,
          status: TeamRequestStatus.ACCEPTED,
        },
      });

      await this.cacheService.del(`tatoueurs:user:${salonUserId}`);
      await this.cacheService.del(`tatoueurs:user:${salonUserId}:appointment-enabled`);

      return {
        error: false,
        message: 'Tatoueur retiré de l\'équipe avec succès.',
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! PERMETTRE A UN TATOUEUR DE QUITTER SON SALON ACTUEL
  async leaveCurrentSalon({
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
          message: 'Seuls les tatoueurs peuvent se retirer d\'un salon.',
        };
      }

      const tatoueur = await this.prisma.user.findUnique({
        where: { id: tatoueurUserId },
        select: {
          id: true,
          role: true,
          salonId: true,
        },
      });

      if (!tatoueur || tatoueur.role !== Role.user_tatoueur) {
        return {
          error: true,
          message: 'Tatoueur introuvable ou invalide.',
        };
      }

      if (!tatoueur.salonId) {
        return {
          error: true,
          message: 'Vous n\'êtes rattaché à aucun salon.',
        };
      }

      const formerSalonId = tatoueur.salonId;

      await this.prisma.user.update({
        where: { id: tatoueurUserId },
        data: { salonId: null },
      });

      // Nettoie l'ancien état ACCEPTED pour permettre une future ré-acceptation
      // du même duo salon/tatoueur sans conflit de contrainte unique.
      await this.prisma.salonTatoueurTeamRequest.deleteMany({
        where: {
          salonId: formerSalonId,
          tatoueurUserId,
          status: TeamRequestStatus.ACCEPTED,
        },
      });

      await this.cacheService.del(`tatoueurs:user:${formerSalonId}`);
      await this.cacheService.del(`tatoueurs:user:${formerSalonId}:appointment-enabled`);

      return {
        error: false,
        message: 'Vous avez quitté le salon avec succès.',
      };
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
      const normalizedStyles = this.normalizeStyles(style);

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
          style: normalizedStyles,
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
