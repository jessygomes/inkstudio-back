/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { AgendaMode, AppointmentStatus, Prisma, PrestationType as PrismaPrestationType } from '@prisma/client';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { CreateAppointmentDto, PrestationType } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { MailService } from 'src/email/mailer.service';
import { FollowupSchedulerService } from 'src/follow-up/followup-scheduler.service';
import { SaasService } from 'src/saas/saas.service';
import * as crypto from 'crypto';
import { VideoCallService } from 'src/video-call/video-call.service';
import { CacheService } from 'src/redis/cache.service';
import { ConversationsService } from 'src/messaging/conversations/conversations.service';
import { SKIN_REQUIRED_PRESTATIONS, SKIN_TONE_OPTIONS, SkinTone } from './constants/skin-tone.constants';
import { CreateAppointmentConsumableDto } from './dto/create-appointment-consumable.dto';
import { UpdateAppointmentConsumableDto } from './dto/update-appointment-consumable.dto';
import { SearchAppointmentConsumablesDto } from './dto/search-appointment-consumables.dto';
import { CreateAppointmentByClientResponse } from './dto/create-appointment-by-client.dto';

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger('AppointmentsService');
  constructor(
    private readonly prisma: PrismaService, 
    private readonly mailService: MailService, 
    private readonly followupSchedulerService: FollowupSchedulerService,
    private readonly saasService: SaasService,
    private readonly videoCallService: VideoCallService,
    private cacheService: CacheService,
    private readonly conversationsService: ConversationsService
  ) {}

  private resolveAppointmentAgendaMode({
    role,
    agendaMode,
  }: {
    role?: string | null;
    agendaMode?: AgendaMode | null;
  }) {
    if (role === 'user_salon') {
      return AgendaMode.PAR_TATOUEUR;
    }

    if (role === 'user_tatoueur') {
      return AgendaMode.GLOBAL;
    }

    return agendaMode ?? AgendaMode.GLOBAL;
  }

  private normalizeTatoueurSelectionId(tatoueurId: string) {
    return tatoueurId.startsWith('linked_') ? tatoueurId.slice('linked_'.length) : tatoueurId;
  }

  private getPerformerDisplayName(performerUser?: {
    salonName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  } | null) {
    if (!performerUser) {
      return 'Tatoueur';
    }

    return performerUser.salonName?.trim() || 'Tatoueur';
  }

  private normalizeAppointmentTatoueur<T extends Record<string, any>>(appointment: T): T {
    if (!appointment || appointment.tatoueur?.name || !appointment.performerUser) {
      return appointment;
    }

    return {
      ...appointment,
      tatoueur: {
        id: appointment.performerUser.id,
        name: this.getPerformerDisplayName(appointment.performerUser as {
          salonName?: string | null;
          firstName?: string | null;
          lastName?: string | null;
        }),
      },
    } as T;
  }

  private normalizeAppointmentsTatoueur<T extends Record<string, any>>(appointments: T[]) {
    return appointments.map((appointment) => this.normalizeAppointmentTatoueur(appointment));
  }

  // Fonction pour construire la condition WHERE pour filtrer les rendez-vous visibles par un utilisateur donné
  private async buildAppointmentVisibilityWhere(userId: string): Promise<Prisma.AppointmentWhereInput> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        // Récupère uniquement les tatoueurs liés qui ont AUTORISÉ le salon à voir leurs RDV
        linkedTatoueurs: {
          where: {
            role: 'user_tatoueur',
            // 🔐 PERMISSION : Filtrer sur salonCanViewAppointments = true
            // Seuls les tatoueurs qui ont donné cette permission apparaissent ici
            salonCanViewAppointments: true,
          },
          select: {
            id: true,
          },
        },
      },
    });

    // Pour un tatoueur lié à un salon : voir ses propres RDV + RDV où il est performerUserId
    if (user?.role === 'user_tatoueur') {
      return {
        OR: [
          { performerUserId: userId },
          { userId },
        ],
      };
    }

    // Pour un user_salon : voir les RDV qu'il crée + RDV de ses tatoueurs liés (si permission accordée)
    if (user?.role === 'user_salon') {
      const linkedTatoueurIds = (user.linkedTatoueurs ?? []).map((tatoueur) => tatoueur.id);

      if (linkedTatoueurIds.length === 0) {
        // Aucun tatoueur autorisé, voir uniquement ses propres RDV
        return { userId };
      }

      return {
        OR: [
          { userId },
          // RDV créés par l'un de ses tatoueurs
          { userId: { in: linkedTatoueurIds } },
          // RDV où l'un de ses tatoueurs est performer (cas tatoueur indépendant devenu lié)
          { performerUserId: { in: linkedTatoueurIds } },
        ],
      };
    }

    // Par défaut : voir uniquement ses propres RDV
    return { userId };
  }

  private async buildScopedAppointmentWhere(
    userId: string,
    scopedWhere?: Prisma.AppointmentWhereInput,
  ): Promise<Prisma.AppointmentWhereInput> {
    const visibilityWhere = await this.buildAppointmentVisibilityWhere(userId);

    if (!scopedWhere) {
      return visibilityWhere;
    }

    return {
      AND: [visibilityWhere, scopedWhere],
    };
  }

  /**
   * Résout les données complètes d'un tatoueur (tatoueur interne ou user_tatoueur lié)
   * 
   * Cette méthode centralise la recherche et normalisation des tatoueurs pour les RDV.
   * Elle récupère aussi les permissions si c'est un user_tatoueur lié à un salon.
   * 
   * @param {string} tatoueurId ID du tatoueur (Tatoueur.id ou User.id si user_tatoueur)
   * @returns {Object} { artist, tatoueurId, performerUserId, linkedSalonId, isLinkedToSalon, allowSalonCreateAppointments }
   */
  private async resolveTatoueurSelection(tatoueurId: string) {
    const resolvedTatoueurId = this.normalizeTatoueurSelectionId(tatoueurId);

    // Cas 1 : Tatoueur interne (table Tatoueur)
    const tatoueur = await this.prisma.tatoueur.findUnique({
      where: { id: resolvedTatoueurId },
      select: {
        id: true,
        name: true,
      },
    });

    if (tatoueur) {
      return {
        artist: tatoueur,
        tatoueurId: tatoueur.id,
        performerUserId: null as string | null,
        linkedSalonId: null as string | null,
        isLinkedToSalon: false,
        // Tatoueur interne : pas de permission liée à un salon
        allowSalonCreateAppointments: null as boolean | null,
        projectAppointmentDurationMinutes: null as number | null,
        projectAppointmentIsFree: null as boolean | null,
        projectAppointmentPrice: null as number | null,
      };
    }

    // Cas 2 : User_tatoueur (table User avec role=user_tatoueur)
    const performerUser = await this.prisma.user.findUnique({
      where: { id: resolvedTatoueurId },
      select: {
        id: true,
        role: true,
        salonId: true,
        // 🔐 Récupère la permission que le user_salon peut créer des RDV pour ce tatoueur
        salonCanCreateAppointments: true,
        salonName: true,
        firstName: true,
        lastName: true,
        projectAppointmentDurationMinutes: true,
        projectAppointmentIsFree: true,
        projectAppointmentPrice: true,
      },
    });

    if (performerUser && performerUser.role === 'user_tatoueur') {
      // Vérifie si ce user_tatoueur est lié à un salon (et pas à lui-même)
      const isLinkedToSalon = !!performerUser.salonId && performerUser.salonId !== performerUser.id;
      const displayName = performerUser.salonName?.trim()
        || `${performerUser.firstName ?? ''} ${performerUser.lastName ?? ''}`.trim()
        || 'Tatoueur';

      return {
        artist: {
          id: performerUser.id,
          name: displayName,
        },
        tatoueurId: null as string | null,
        performerUserId: performerUser.id,
        linkedSalonId: performerUser.salonId ?? null,
        isLinkedToSalon,
        // 🔐 Permission persisted lors de l'acceptance de la demande d'équipe
        // null si non lié, boolean si lié
        allowSalonCreateAppointments: performerUser.salonCanCreateAppointments,
        projectAppointmentDurationMinutes: performerUser.projectAppointmentDurationMinutes,
        projectAppointmentIsFree: performerUser.projectAppointmentIsFree,
        projectAppointmentPrice: performerUser.projectAppointmentPrice,
      };
    }

    // Cas 3 : Tatoueur non trouvé
    return {
      artist: null,
      tatoueurId: null as string | null,
      performerUserId: null as string | null,
      linkedSalonId: null as string | null,
      isLinkedToSalon: false,
      allowSalonCreateAppointments: null as boolean | null,
      projectAppointmentDurationMinutes: null as number | null,
      projectAppointmentIsFree: null as boolean | null,
      projectAppointmentPrice: null as number | null,
    };
  }

  /**
   * Valide que le user_salon peut créer un RDV pour un user_tatoueur sélectionné
   * 
   * Logique d'autorisation :
   * - Tatoueur interne (table Tatoueur) : TOUJOURS autorisé
   * - User_tatoueur indépendant : TOUJOURS autorisé (pas lié à un salon)
   * - User_tatoueur lié à CE salon ET allowSalonCreateAppointments=true : AUTORISÉ
   * - User_tatoueur lié à CE salon ET allowSalonCreateAppointments=false : REJETÉ ❌
   * - User_tatoueur lié à AUTRE salon : REJETÉ (conflit de lien)
   * 
   * @param {Object} params
   * @param {string} params.salonId ID du user_salon qui crée le RDV
   * @param {Object} params.selectedTatoueur Réponse de resolveTatoueurSelection()
   * 
   * @returns {string|null} Message d'erreur si bloqué, null sinon
   */
  private validateSalonCanCreateForSelection({
    salonId,
    selectedTatoueur,
  }: {
    salonId: string;
    selectedTatoueur: {
      performerUserId: string | null;
      isLinkedToSalon: boolean;
      linkedSalonId: string | null;
      allowSalonCreateAppointments: boolean | null;
    };
  }): string | null {
    // Cas : User_tatoueur lié à CE salon ET permission refusée
    if (
      selectedTatoueur.performerUserId
      && selectedTatoueur.isLinkedToSalon
      && selectedTatoueur.linkedSalonId === salonId
      && selectedTatoueur.allowSalonCreateAppointments === false
    ) {
      return 'Ce tatoueur n\'autorise pas le salon à créer des rendez-vous pour lui.';
    }

    return null;
  }

  getSkinTones() {
    return SKIN_TONE_OPTIONS;
  }

  private validateSkinToneForPrestation(prestation: string, skin?: string | null) {
    if (!skin) {
      if (SKIN_REQUIRED_PRESTATIONS.includes(prestation)) {
        return 'La teinte de peau est requise pour un rendez-vous tattoo, retouche ou projet.';
      }

      return null;
    }

    if (!Object.values(SkinTone).includes(skin as SkinTone)) {
      return 'La teinte de peau fournie est invalide.';
    }

    return null;
  }

  private async resolveValidatedMoodboardId({
    moodboardId,
    clientUserId,
  }: {
    moodboardId?: string;
    clientUserId?: string;
  }) {
    if (!moodboardId) {
      return { moodboardId: undefined, errorMessage: null as string | null };
    }

    if (!clientUserId) {
      return {
        moodboardId: undefined,
        errorMessage:
          'Vous devez être connecté en tant que client pour lier un moodboard au rendez-vous.',
      };
    }

    const moodboard = await this.prisma.moodboard.findFirst({
      where: {
        id: moodboardId,
        clientProfile: {
          userId: clientUserId,
        },
      },
      select: { id: true },
    });

    if (!moodboard) {
      return {
        moodboardId: undefined,
        errorMessage: 'Moodboard introuvable ou non autorisé pour ce client.',
      };
    }

    return { moodboardId: moodboard.id, errorMessage: null as string | null };
  }

  private async findAppointmentConflict({
    userId,
    start,
    end,
    tatoueurId,
    performerUserId,
    agendaMode,
    excludedAppointmentId,
  }: {
    userId: string;
    start: Date;
    end: Date;
    tatoueurId?: string | null;
    performerUserId?: string | null;
    agendaMode: AgendaMode;
    excludedAppointmentId?: string;
  }) {
    const where: Record<string, any> = {
      userId,
      status: { in: ['PENDING', 'CONFIRMED', 'RESCHEDULING'] },
      start: { lt: end },
      end: { gt: start },
    };

    if (excludedAppointmentId) {
      where.id = { not: excludedAppointmentId };
    }

    if (agendaMode === AgendaMode.PAR_TATOUEUR) {
      if (performerUserId) {
        where.performerUserId = performerUserId;
      } else if (tatoueurId) {
        where.tatoueurId = tatoueurId;
      }
    }

    return this.prisma.appointment.findFirst({
      where,
      select: { id: true },
    });
  }

  private async getConsumableAppointmentForUser(appointmentId: string, userId: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        userId,
      },
      select: {
        id: true,
        prestation: true,
      },
    });

    if (!appointment) {
      return {
        appointment: null,
        error: {
          error: true,
          message: 'Rendez-vous introuvable ou non autorisé.',
        },
      };
    }

    const allowedPrestations = ['TATTOO', 'PIERCING', 'RETOUCHE'];
    if (!allowedPrestations.includes(appointment.prestation)) {
      return {
        appointment: null,
        error: {
          error: true,
          message: 'Les consommables sont disponibles uniquement pour Tattoo, Retouche et Piercing.',
        },
      };
    }

    return {
      appointment,
      error: null,
    };
  }

  //! ------------------------------------------------------------------------------

  //! CONSOMMABLES - CREER

  //! ------------------------------------------------------------------------------
  async createAppointmentConsumable(
    appointmentId: string,
    userId: string,
    dto: CreateAppointmentConsumableDto,
  ) {
    try {
      const validation = await this.getConsumableAppointmentForUser(appointmentId, userId);
      if (validation.error) {
        return validation.error;
      }

      const consumable = await this.prisma.appointmentConsumable.create({
        data: {
          appointmentId,
          userId,
          stockItemId: dto.stockItemId,
          category: dto.category,
          productName: dto.productName,
          brand: dto.brand,
          reference: dto.reference,
          pigment: dto.pigment,
          lotNumber: dto.lotNumber,
          expirationDate: dto.expirationDate ? new Date(dto.expirationDate) : undefined,
          quantity: dto.quantity,
          unit: dto.unit,
          notes: dto.notes,
        },
      });

      await this.cacheService.del(`appointment:${appointmentId}`);

      return {
        error: false,
        message: 'Consommable ajouté au rendez-vous.',
        consumable,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! ------------------------------------------------------------------------------

  //! CONSOMMABLES - LISTER PAR RDV

  //! ------------------------------------------------------------------------------
  async getAppointmentConsumables(appointmentId: string, userId: string) {
    try {
      const validation = await this.getConsumableAppointmentForUser(appointmentId, userId);
      if (validation.error) {
        return validation.error;
      }

      const consumables = await this.prisma.appointmentConsumable.findMany({
        where: {
          appointmentId,
          userId,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return {
        error: false,
        consumables,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! ------------------------------------------------------------------------------

  //! CONSOMMABLES - RECHERCHE LOT/REFERENCE/DATE

  //! ------------------------------------------------------------------------------
  async searchAppointmentConsumables(userId: string, query: SearchAppointmentConsumablesDto) {
    try {
      const page = Math.max(1, Number(query.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
      const skip = (page - 1) * limit;

      const where: any = {
        userId,
      };

      if (query.lotNumber?.trim()) {
        where.lotNumber = {
          contains: query.lotNumber.trim(),
          mode: 'insensitive',
        };
      }

      if (query.reference?.trim()) {
        where.reference = {
          contains: query.reference.trim(),
          mode: 'insensitive',
        };
      }

      if (query.expirationDateFrom || query.expirationDateTo) {
        where.expirationDate = {};

        if (query.expirationDateFrom) {
          where.expirationDate.gte = new Date(query.expirationDateFrom);
        }

        if (query.expirationDateTo) {
          where.expirationDate.lte = new Date(query.expirationDateTo);
        }
      }

      const [total, consumables] = await this.prisma.$transaction([
        this.prisma.appointmentConsumable.count({ where }),
        this.prisma.appointmentConsumable.findMany({
          where,
          skip,
          take: limit,
          orderBy: {
            createdAt: 'desc',
          },
          include: {
            appointment: {
              select: {
                id: true,
                prestation: true,
                start: true,
                end: true,
              },
            },
          },
        }),
      ]);

      return {
        error: false,
        consumables,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
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

  //! ------------------------------------------------------------------------------

  //! CONSOMMABLES - METTRE A JOUR

  //! ------------------------------------------------------------------------------
  async updateAppointmentConsumable(
    appointmentId: string,
    consumableId: string,
    userId: string,
    dto: UpdateAppointmentConsumableDto,
  ) {
    try {
      const validation = await this.getConsumableAppointmentForUser(appointmentId, userId);
      if (validation.error) {
        return validation.error;
      }

      const existingConsumable = await this.prisma.appointmentConsumable.findFirst({
        where: {
          id: consumableId,
          appointmentId,
          userId,
        },
        select: { id: true },
      });

      if (!existingConsumable) {
        return {
          error: true,
          message: 'Consommable introuvable pour ce rendez-vous.',
        };
      }

      const consumable = await this.prisma.appointmentConsumable.update({
        where: { id: consumableId },
        data: {
          stockItemId: dto.stockItemId,
          category: dto.category,
          productName: dto.productName,
          brand: dto.brand,
          reference: dto.reference,
          pigment: dto.pigment,
          lotNumber: dto.lotNumber,
          expirationDate: dto.expirationDate ? new Date(dto.expirationDate) : undefined,
          quantity: dto.quantity,
          unit: dto.unit,
          notes: dto.notes,
        },
      });

      await this.cacheService.del(`appointment:${appointmentId}`);

      return {
        error: false,
        message: 'Consommable mis à jour.',
        consumable,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! ------------------------------------------------------------------------------

  //! CONSOMMABLES - SUPPRIMER

  //! ------------------------------------------------------------------------------
  async deleteAppointmentConsumable(appointmentId: string, consumableId: string, userId: string) {
    try {
      const validation = await this.getConsumableAppointmentForUser(appointmentId, userId);
      if (validation.error) {
        return validation.error;
      }

      const existingConsumable = await this.prisma.appointmentConsumable.findFirst({
        where: {
          id: consumableId,
          appointmentId,
          userId,
        },
        select: { id: true },
      });

      if (!existingConsumable) {
        return {
          error: true,
          message: 'Consommable introuvable pour ce rendez-vous.',
        };
      }

      await this.prisma.appointmentConsumable.delete({
        where: {
          id: consumableId,
        },
      });

      await this.cacheService.del(`appointment:${appointmentId}`);

      return {
        error: false,
        message: 'Consommable supprimé.',
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! ------------------------------------------------------------------------------

  //! GESTION DU CACHE DASHBOARD

  //! ------------------------------------------------------------------------------
  /**
   * Invalide tous les caches liés au dashboard pour un salon
   * À appeler après toute modification d'un rendez-vous
   * @param userId - ID du salon
   * @param appointmentData - Données du RDV pour optimiser l'invalidation
   */
  private async invalidateDashboardCache(userId: string, appointmentData?: { start?: Date, isPayed?: boolean }) {
    try {
      const keysToDelete = [
        `dashboard:global-cancellation:${userId}`,
      ];

      // Si on a des infos sur le RDV, optimiser l'invalidation
      if (appointmentData?.start) {
        const appointmentDate = new Date(appointmentData.start);
        const year = appointmentDate.getFullYear();
        const month = appointmentDate.getMonth() + 1;
        const dateKey = appointmentDate.toISOString().split('T')[0];
        
        keysToDelete.push(
          `dashboard:today-appointments:${userId}:${dateKey}`,
          `dashboard:monthly-paid:${userId}:${year}-${month.toString().padStart(2, '0')}`
        );
      }

      // Invalider les clés spécifiques
      for (const key of keysToDelete) {
        try {
          await this.cacheService.del(key);
        } catch (error) {
          console.warn(`Erreur invalidation cache dashboard clé ${key}:`, error);
        }
      }

      // Pour les caches avec patterns complexes (fill-rate), on invalide manuellement les plus probables
      if (appointmentData?.start) {
        const appointmentDate = new Date(appointmentData.start);
        // Invalider les fill-rate des 7 derniers jours autour de la date du RDV
        for (let i = -3; i <= 3; i++) {
          const checkDate = new Date(appointmentDate);
          checkDate.setDate(appointmentDate.getDate() + i);
          const startWeek = checkDate.toISOString().split('T')[0];
          const endWeek = new Date(checkDate);
          endWeek.setDate(checkDate.getDate() + 7);
          const endWeekStr = endWeek.toISOString().split('T')[0];
          
          try {
            await this.cacheService.del(`dashboard:fill-rate:${userId}:${startWeek}:${endWeekStr}`);
          } catch {
            // Ignore les erreurs pour ces clés optionnelles
          }
        }
      }

    } catch (error) {
      console.warn('Erreur invalidation cache dashboard:', error);
    }
  }

//! ------------------------------------------------------------------------------

  //! CREER UN RDV

  //! ------------------------------------------------------------------------------
  async create({ userId, rdvBody }: {userId: string, rdvBody: CreateAppointmentDto}) {
    try {
      const {  title, prestation, start, end, clientFirstname, clientLastname, clientEmail, clientPhone, clientBirthdate, tatoueurId, visio, visioRoom, skin, moodboardId } = rdvBody;

      const skinValidationError = this.validateSkinToneForPrestation(prestation, skin);
      if (skinValidationError) {
        return {
          error: true,
          message: skinValidationError,
        };
      }

      // S'assurer que title a toujours une valeur
      const appointmentTitle = title || `${prestation} - ${clientFirstname} ${clientLastname}`;

      // Convertir la date de naissance en objet Date si elle est fournie
      const parsedBirthdate = clientBirthdate ? new Date(clientBirthdate) : null;

      const selectedTatoueur = await this.resolveTatoueurSelection(tatoueurId);
      const artist = selectedTatoueur.artist;
      if (!artist) {
        return {
          error: true,
          message: 'Tatoueur introuvable.',
        };
      }

      // 🔐 PERMISSION DE CRÉATION : Vérifier si le user_salon peut créer un RDV pour ce user_tatoueur lié
      // Si c'est un user_tatoueur lié à CE salon ET qu'il a refusé l'autorisation :
      // → La création est bloquée avec code 'SALON_BOOKING_NOT_ALLOWED'
      const salonCreationPermissionError = this.validateSalonCanCreateForSelection({
        salonId: userId,
        selectedTatoueur,
      });

      if (salonCreationPermissionError) {
        return {
          error: true,
          code: 'SALON_BOOKING_NOT_ALLOWED',
          message: salonCreationPermissionError,
          performerUserId: selectedTatoueur.performerUserId,
        };
      }

      // Vérifier s'il existe un utilisateur connecté avec cet email (role="client")
      const clientUser = await this.prisma.user.findUnique({
        where: {
          email: clientEmail,
          role: 'client',
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          role: true,
          clientProfile: {
            select: {
              birthDate: true,
            }
          }
        }
      });

      const salonConfig = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          role: true,
          salonName: true,
          saasPlan: true,
          saasPlanDetails: {
            select: {
              currentPlan: true,
              agendaMode: true,
            },
          },
        },
      });

      if (!salonConfig) {
        return {
          error: true,
          message: 'Salon introuvable.',
        };
      }

      const agendaMode = this.resolveAppointmentAgendaMode({
        role: salonConfig.role,
        agendaMode: salonConfig.saasPlanDetails?.agendaMode,
      });

      const existingAppointment = await this.findAppointmentConflict({
        userId,
        start: new Date(start),
        end: new Date(end),
        tatoueurId: selectedTatoueur.tatoueurId,
        performerUserId: selectedTatoueur.performerUserId,
        agendaMode,
      });

      if (existingAppointment) {
        return {
          error: true,
          message: 'Ce créneau horaire est déjà réservé.',
        };
      }

      let client = await this.prisma.client.findFirst({
        where: {
          email: clientEmail,
          userId: userId, // Pour que chaque salon ait ses propres clients
        },
      });

      if (!client) {
        // Créer le client s'il n'existe pas
        // Si c'est un client connecté, utiliser ses données du compte utilisateur
        const clientData = clientUser ? {
          firstName: clientUser.firstName || clientFirstname,
          lastName: clientUser.lastName || clientLastname,
          email: clientEmail,
          phone: clientUser.phone || clientPhone || "",
          birthDate: clientUser.clientProfile?.birthDate || parsedBirthdate,
          userId,
          linkedUserId: clientUser.id, // Lier au compte utilisateur connecté
        } : {
          firstName: clientFirstname,
          lastName: clientLastname,
          email: clientEmail,
          phone: clientPhone || "",
          birthDate: parsedBirthdate,
          userId,
        };

        client = await this.prisma.client.create({
          data: clientData,
        });
      } else {
        // Si le client existe, vérifier s'il faut créer ou mettre à jour la liaison
        if (clientUser) {
          if (!client.linkedUserId) {
            // Créer la liaison si elle n'existe pas
            client = await this.prisma.client.update({
              where: { id: client.id },
              data: { linkedUserId: clientUser.id }
            });
          }

          // Mettre à jour les infos de la fiche client avec celles du compte utilisateur
          const updatedData: Record<string, string | Date> = {};
          
          // Synchroniser les données si elles sont différentes ou manquantes
          if (clientUser.firstName && (!client.firstName || client.firstName !== clientUser.firstName)) {
            updatedData.firstName = clientUser.firstName;
          }
          
          if (clientUser.lastName && (!client.lastName || client.lastName !== clientUser.lastName)) {
            updatedData.lastName = clientUser.lastName;
          }
          
          if (clientUser.phone && (!client.phone || client.phone !== clientUser.phone)) {
            updatedData.phone = clientUser.phone;
          }
          
          if (clientUser.clientProfile?.birthDate && (!client.birthDate || client.birthDate.getTime() !== clientUser.clientProfile.birthDate.getTime())) {
            updatedData.birthDate = clientUser.clientProfile.birthDate;
          }

          // Appliquer les mises à jour si nécessaire
          if (Object.keys(updatedData).length > 0) {
            client = await this.prisma.client.update({
              where: { id: client.id },
              data: updatedData
            });
          }
        }
      }

      // Générer le lien de visioconférence si nécessaire
      let generatedVisioRoom = visioRoom;
      if (visio && !visioRoom) {
        // Générer un ID temporaire pour créer le lien vidéo
        const tempAppointmentId = crypto.randomBytes(8).toString('hex');
        generatedVisioRoom = this.videoCallService.generateVideoCallLink(tempAppointmentId, salonConfig?.salonName || undefined);
      }

      const moodboardValidation = await this.resolveValidatedMoodboardId({
        moodboardId,
        clientUserId: clientUser?.id,
      });

      if (moodboardValidation.errorMessage) {
        return {
          error: true,
          message: moodboardValidation.errorMessage,
        };
      }

      if (prestation === PrestationType.PROJET || prestation === PrestationType.TATTOO || prestation === PrestationType.PIERCING || prestation === PrestationType.RETOUCHE) {
        // Créer le rendez-vous
        const newAppointment = await this.prisma.appointment.create({
          data: {
            userId,
            title: appointmentTitle,
            prestation,
            start: new Date(start),
            end: new Date(end),
            tatoueurId: selectedTatoueur.tatoueurId ?? undefined,
            performerUserId: selectedTatoueur.performerUserId ?? undefined,
            clientId: client.id,
            clientUserId: clientUser?.id, // Lier au client connecté si applicable
            moodboardId: moodboardValidation.moodboardId,
            skin,
            status: 'CONFIRMED',
            visio: visio || false,
            visioRoom: generatedVisioRoom
          } as any,
          include: {
            tatoueur: {
              select: {
                name: true
              }
            },
            performerUser: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                salonName: true,
              },
            }
          }
        });
        // Gérer les détails spécifiques selon le type de prestation
        if (prestation === PrestationType.PIERCING) {
          // Pour les piercings, récupérer le prix automatiquement si possible
          let piercingPrice = rdvBody.price || rdvBody.estimatedPrice || 0;

          // Déterminer l'ID du service de piercing depuis les données du front
          let piercingServiceId = rdvBody.piercingServicePriceId;
          
          // Si pas d'ID direct, chercher dans les anciens champs
          if (!piercingServiceId) {
            piercingServiceId = rdvBody.piercingZoneOreille || 
                              rdvBody.piercingZoneVisage || 
                              rdvBody.piercingZoneBouche || 
                              rdvBody.piercingZoneCorps || 
                              rdvBody.piercingZoneMicrodermal;
          }

          if (piercingServiceId) {
            try {
              const piercingPriceConfig = await this.prisma.piercingServicePrice.findUnique({
                where: {
                  id: piercingServiceId,
                  userId,
                  isActive: true,
                },
                select: {
                  price: true,
                },
              });

              if (piercingPriceConfig) {
                piercingPrice = piercingPriceConfig.price;
              }
            } catch (priceError) {
              console.warn('⚠️ Erreur lors de la récupération du prix piercing par ID:', priceError);
            }
          }

          const tattooDetail = await this.prisma.tattooDetail.create({
            data: {
              appointmentId: newAppointment.id,
              clientId: client.id,
              description: rdvBody.description || '',
              zone: rdvBody.zone || '',
              size: rdvBody.size || '',
              colorStyle: rdvBody.colorStyle || '',
              reference: rdvBody.reference,
              sketch: rdvBody.sketch,
              // Champs spécifiques aux piercings
              piercingZone: rdvBody.piercingZone,
              piercingServicePriceId: piercingServiceId,
              estimatedPrice: rdvBody.estimatedPrice || piercingPrice,
              price: piercingPrice,
            },
          });

          // Mettre à jour l'appointment avec l'ID du tattooDetail
          await this.prisma.appointment.update({
            where: { id: newAppointment.id },
            data: { tattooDetailId: tattooDetail.id },
          });
        } else {
          // Pour les autres prestations (TATTOO, PROJET, RETOUCHE)
          const tattooDetail = await this.prisma.tattooDetail.create({
            data: {
              appointmentId: newAppointment.id,
              clientId: client.id,
              description: rdvBody.description || '',
              zone: rdvBody.zone || '',
              size: rdvBody.size || '',
              colorStyle: rdvBody.colorStyle || '',
              reference: rdvBody.reference,
              sketch: rdvBody.sketch,
              estimatedPrice: rdvBody.estimatedPrice || 0,
              price: rdvBody.price || 0,
            },
          });

          // Mettre à jour l'appointment avec l'ID du tattooDetail
          await this.prisma.appointment.update({
            where: { id: newAppointment.id },
            data: { tattooDetailId: tattooDetail.id },
          });
        }
        
        try {
          await this.mailService.sendAppointmentConfirmation(
            client.email, 
            {
              recipientName: `${client.firstName} ${client.lastName}`,
              appointmentDetails: {
                date: newAppointment.start.toLocaleDateString('fr-FR', { 
                  weekday: 'long', 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                }),
                time: `${newAppointment.start.toLocaleTimeString('fr-FR', { 
                  hour: '2-digit', 
                  minute: '2-digit' 
                })} - ${newAppointment.end.toLocaleTimeString('fr-FR', { 
                  hour: '2-digit', 
                  minute: '2-digit' 
                })}`,
                service: newAppointment.prestation,
                tatoueur: artist.name || 'Non assigne',
                visio: visio || false,
                visioRoom: visio ? `${process.env.FRONTEND_URL || '#'}/meeting/${newAppointment.id}` : generatedVisioRoom
              }
            },
            salonConfig?.salonName || undefined, // Passer le nom du salon
            undefined, // salonEmail
            userId // Passer l'ID utilisateur pour les couleurs
          );
        } catch (emailError) {
          console.error('💥 ERREUR lors de l\'envoi de l\'email PROJET/TATTOO:', emailError);
          // Ne pas faire échouer la création du RDV si l'email échoue
        }

        // Invalider le cache des listes de RDV après création
        await this.cacheService.delPattern(`appointments:salon:${userId}:*`);
        await this.cacheService.delPattern(`appointments:date-range:${userId}:*`);

        // Créer une conversation automatiquement si le client est connecté
        if (clientUser && clientUser.role === 'client') {
          try {
            const prestationLabel = prestation === PrestationType.PROJET ? 'Projet tatouage' :
              prestation === PrestationType.TATTOO ? 'Tatouage' :
              prestation === PrestationType.PIERCING ? 'Piercing' :
              prestation === PrestationType.RETOUCHE ? 'Retouche' : prestation;

            await this.conversationsService.createConversation(userId, {
              clientUserId: clientUser.id,
              appointmentId: newAppointment.id,
              subject: `RDV ${prestationLabel} - ${newAppointment.start.toLocaleDateString('fr-FR')}`,
              firstMessage: `Bonjour ${client.firstName}, votre rendez-vous a été confirmé ! N'hésitez pas à nous contacter pour toute question.`,
            });
          } catch (conversationError) {
            console.error('⚠️ Erreur lors de la création de la conversation:', conversationError);
            // Ne pas faire échouer la création du RDV si la conversation échoue
          }
        }
      
        return {
          error: false,
          message: 'Rendez-vous projet créé avec détail tatouage.',
          appointment: newAppointment,
          clientLinked: !!clientUser, // Indiquer si le client était connecté
          // tattooDetail,
        };
      }

      // Créer le rendez-vous
      const newAppointment = await this.prisma.appointment.create({
        data: {
          userId,
          title: appointmentTitle,
          prestation,
          start: new Date(start),
          end: new Date(end),
          tatoueurId: selectedTatoueur.tatoueurId ?? undefined,
          performerUserId: selectedTatoueur.performerUserId ?? undefined,
          clientId: client.id,
          clientUserId: clientUser?.id, // Lier au client connecté si applicable
          moodboardId: moodboardValidation.moodboardId,
          visio: visio || false,
          visioRoom: generatedVisioRoom
        },
        include: {
          tatoueur: {
            select: {
              name: true
            }
          }
        }
      });

      // Récupérer les informations du salon pour le nom
      const salon = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { salonName: true }
      });
      
      try {
        await this.mailService.sendAppointmentConfirmation(
          client.email, 
          {
            recipientName: `${client.firstName} ${client.lastName}`,
            appointmentDetails: {
              date: newAppointment.start.toLocaleDateString('fr-FR', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
              }),
              time: `${newAppointment.start.toLocaleTimeString('fr-FR', { 
                hour: '2-digit', 
                minute: '2-digit' 
              })} - ${newAppointment.end.toLocaleTimeString('fr-FR', { 
                hour: '2-digit', 
                minute: '2-digit' 
              })}`,
              service: newAppointment.prestation,
              tatoueur: newAppointment.tatoueur?.name || 'Non assigné',
              visio: visio || false,
              visioRoom: visio ? `${process.env.FRONTEND_URL || '#'}/meeting/${newAppointment.id}` : generatedVisioRoom
            }
          },
          salon?.salonName || undefined // Passer le nom du salon
        );
      } catch (emailError) {
        console.error('💥 ERREUR lors de l\'envoi de l\'email:', emailError);
        // Ne pas faire échouer la création du RDV si l'email échoue
      }

      // Invalider le cache des listes de RDV après création
      await this.cacheService.delPattern(`appointments:salon:${userId}:*`);
      await this.cacheService.delPattern(`appointments:date-range:${userId}:*`);

      // Invalider le cache du dashboard
      await this.invalidateDashboardCache(userId, { 
        start: newAppointment.start, 
        isPayed: newAppointment.isPayed 
      });
      
      // Créer une conversation automatiquement si le client est connecté
      if (clientUser && clientUser.role === 'client') {
        try {
          const prestationLabel = prestation === PrestationType.PROJET ? 'Projet tatouage' :
            prestation === PrestationType.TATTOO ? 'Tatouage' :
            prestation === PrestationType.PIERCING ? 'Piercing' :
            prestation === PrestationType.RETOUCHE ? 'Retouche' : prestation;

          await this.conversationsService.createConversation(userId, {
            clientUserId: clientUser.id,
            appointmentId: newAppointment.id,
            subject: `RDV ${prestationLabel} - ${newAppointment.start.toLocaleDateString('fr-FR')}`,
            firstMessage: `Bonjour ${client.firstName}, votre rendez-vous a été confirmé ! N'hésitez pas à nous contacter pour toute question.`,
          });
        } catch (conversationError) {
          console.error('⚠️ Erreur lors de la création de la conversation:', conversationError);
          // Ne pas faire échouer la création du RDV si la conversation échoue
        }
      }

      return {
        error: false,
        message: 'Rendez-vous créé avec succès.',
        appointment: newAppointment,
        clientLinked: !!clientUser, // Indiquer si le client était connecté
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! ------------------------------------------------------------------------------

  //! CREER UN RDV PAR UN CLIENT (sans authentification)

  //! ------------------------------------------------------------------------------
  async createByClient({ userId, rdvBody, clientUserId }: {userId: string | undefined, rdvBody: CreateAppointmentDto & { clientUserId?: string }, clientUserId?: string}): Promise<CreateAppointmentByClientResponse> {
    try {
      // Vérifier que userId est fourni
      if (!userId) {
        return {
          error: true,
          message: 'ID du salon requis.',
        };
      }

      const { title, prestation, start, end, clientFirstname, clientLastname, clientEmail, clientPhone, clientBirthdate, tatoueurId, visio, visioRoom, skin, moodboardId, flashId } = rdvBody;

      const skinValidationError = this.validateSkinToneForPrestation(prestation, skin);
      if (skinValidationError) {
        return {
          error: true,
          message: skinValidationError,
        };
      }

      // S'assurer que title a toujours une valeur
      let appointmentTitle = title || `${prestation} - ${clientFirstname} ${clientLastname}`;

      // Convertir la date de naissance en objet Date si elle est fournie
      const parsedBirthdate = clientBirthdate ? new Date(clientBirthdate) : null;

      const effectiveClientUserId = clientUserId ?? rdvBody?.clientUserId;
      const clientUser = effectiveClientUserId
        ? await this.prisma.user.findUnique({
            where: { id: effectiveClientUserId },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true,
              role: true,
              clientProfile: {
                select: {
                  birthDate: true,
                },
              },
            },
          })
        : await this.prisma.user.findUnique({
            where: {
              email: clientEmail,
              role: 'client',
            },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true,
              role: true,
              clientProfile: {
                select: {
                  birthDate: true,
                },
              },
            },
          });

      const salonConfig = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          role: true,
          addConfirmationEnabled: true,
          salonName: true,
          email: true,
          projectAppointmentDurationMinutes: true,
          projectAppointmentIsFree: true,
          projectAppointmentPrice: true,
          saasPlan: true,
          saasPlanDetails: {
            select: {
              currentPlan: true,
              agendaMode: true,
            },
          },
        },
      });

      if (!salonConfig) {
        return {
          error: true,
          message: 'Salon introuvable.',
        };
      }

      const agendaMode = this.resolveAppointmentAgendaMode({
        role: salonConfig.role,
        agendaMode: salonConfig.saasPlanDetails?.agendaMode,
      });

      const selectedTatoueur = tatoueurId ? await this.resolveTatoueurSelection(tatoueurId) : {
        artist: null,
        tatoueurId: null as string | null,
        performerUserId: null as string | null,
        linkedSalonId: null as string | null,
        isLinkedToSalon: false,
        allowSalonCreateAppointments: null as boolean | null,
        projectAppointmentDurationMinutes: null as number | null,
        projectAppointmentIsFree: null as boolean | null,
        projectAppointmentPrice: null as number | null,
      };

      let artist: { id: string; name: string } | null = null;
      if (tatoueurId) {
        artist = selectedTatoueur.artist;

        if (!artist) {
          return {
            error: true,
            message: 'Tatoueur introuvable.',
          };
        }

        if (
          selectedTatoueur.performerUserId
          && selectedTatoueur.isLinkedToSalon
          && selectedTatoueur.linkedSalonId === userId
        ) {
          return {
            error: true,
            code: 'LINKED_BOOKING_REDIRECT',
            message: 'La reservation client avec ce tatoueur n\'est plus disponible depuis le profil du salon. Merci de reserver directement depuis le profil du tatoueur.',
            performerUserId: selectedTatoueur.performerUserId,
          };
        }
      }

      const flashOwnerScope = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          role: true,
          linkedTatoueurs: {
            select: {
              id: true,
            },
          },
        },
      });

      const linkedTatoueurUserIds = flashOwnerScope?.role === 'user_salon'
        ? (flashOwnerScope.linkedTatoueurs ?? []).map((tatoueurUser) => tatoueurUser.id)
        : [];

      const flashOwnerIds = Array.from(new Set([userId, ...linkedTatoueurUserIds]));

      const selectedFlash = flashId
        ? await this.prisma.flash.findFirst({
            where: {
              id: flashId,
              isAvailable: true,
              userId: flashOwnerIds.length === 1 ? flashOwnerIds[0] : { in: flashOwnerIds },
            },
            select: {
              id: true,
              title: true,
              price: true,
              appointmentDurationMinutes: true,
            },
          })
        : null;

      if (flashId && !selectedFlash) {
        return {
          error: true,
          message: 'Flash introuvable ou indisponible pour ce profil.',
        };
      }

      if (!title && selectedFlash) {
        appointmentTitle = `FLASH - ${selectedFlash.title}`;
      }

      const projectDurationMinutes = prestation === PrestationType.PROJET
        ? (selectedTatoueur.projectAppointmentDurationMinutes
            ?? salonConfig.projectAppointmentDurationMinutes
            ?? 60)
        : null;

      const projectIsFree = prestation === PrestationType.PROJET
        ? (selectedTatoueur.projectAppointmentIsFree
            ?? salonConfig.projectAppointmentIsFree
            ?? true)
        : null;

      const projectPrice = prestation === PrestationType.PROJET
        ? (projectIsFree
            ? 0
            : (selectedTatoueur.projectAppointmentPrice
                ?? salonConfig.projectAppointmentPrice
                ?? 0))
        : null;

      const flashDurationMinutes = selectedFlash
        ? Math.max(15, Math.round(Number(selectedFlash.appointmentDurationMinutes) || 60))
        : null;

      const effectiveStartDate = new Date(start);
      const effectiveDurationMinutes = flashDurationMinutes ?? projectDurationMinutes;
      const effectiveEndDate = effectiveDurationMinutes
        ? new Date(effectiveStartDate.getTime() + effectiveDurationMinutes * 60 * 1000)
        : new Date(end);

      const existingAppointment = await this.findAppointmentConflict({
        userId,
        start: effectiveStartDate,
        end: effectiveEndDate,
        tatoueurId: selectedTatoueur.tatoueurId,
        performerUserId: selectedTatoueur.performerUserId,
        agendaMode,
      });

      if (existingAppointment) {
        return {
          error: true,
          message: 'Ce créneau horaire est déjà réservé.',
        };
      }

      // Chercher le client dans la base de données
      // Chaque salon doit avoir sa propre fiche client
      // Si le client est connecté (linkedUserId), on peut avoir plusieurs fiches (une par salon)
      let client: {
        id: string;
        firstName: string;
        lastName: string;
        email: string;
        phone: string;
        linkedUserId: string | null;
      } | null = null;
      
      if (clientUser) {
        // Si un utilisateur client connecté existe, chercher une fiche pour CE salon avec ce linkedUserId
        client = await this.prisma.client.findFirst({
          where: {
            linkedUserId: clientUser.id,
            userId: userId, // Fiche client spécifique à ce salon
          },
        });
      }
      
      // Si pas trouvé par linkedUserId, chercher par email pour ce salon
      if (!client) {
        client = await this.prisma.client.findFirst({
          where: {
            email: clientEmail,
            userId: userId, // Pour que chaque salon ait ses propres clients
          },
        });
      }

      if (!client) {
        // Créer le client s'il n'existe pas
        // Si c'est un client connecté, utiliser ses données
        const clientData = clientUser ? {
          firstName: clientUser.firstName || clientFirstname,
          lastName: clientUser.lastName || clientLastname,
          email: clientEmail,
          phone: clientUser.phone || clientPhone || "",
          birthDate: clientUser.clientProfile?.birthDate || parsedBirthdate,
          userId,
          linkedUserId: clientUser.id, // Lier au compte utilisateur connecté
        } : {
          firstName: clientFirstname,
          lastName: clientLastname,
          email: clientEmail,
          phone: clientPhone || "",
          birthDate: parsedBirthdate,
          userId,
        };

        client = await this.prisma.client.create({
          data: clientData,
        });
      } else if (clientUser && !client.linkedUserId) {
        // Si le client existe mais n'est pas encore lié au compte utilisateur, créer la liaison
        client = await this.prisma.client.update({
          where: { id: client.id },
          data: { linkedUserId: clientUser.id }
        });
      }

      if (!client) {
        return {
          error: true,
          message: 'Impossible de créer ou récupérer le client.',
        };
      }

      // Déterminer le statut du rendez-vous selon addConfirmationEnabled
      const appointmentStatus = salonConfig.addConfirmationEnabled ? 'PENDING' : 'CONFIRMED';

      // Générer le lien de visioconférence si nécessaire
      let generatedVisioRoom = visioRoom;
      if (visio && !visioRoom) {
        // Générer un ID temporaire pour créer le lien vidéo
        const tempAppointmentId = crypto.randomBytes(8).toString('hex');
        generatedVisioRoom = this.videoCallService.generateVideoCallLink(tempAppointmentId, salonConfig?.salonName || undefined);
      }

      const moodboardValidation = await this.resolveValidatedMoodboardId({
        moodboardId,
        clientUserId: effectiveClientUserId,
      });

      if (moodboardValidation.errorMessage) {
        return {
          error: true,
          message: moodboardValidation.errorMessage,
        };
      }

      if (prestation === PrestationType.PROJET || prestation === PrestationType.TATTOO || prestation === PrestationType.PIERCING || prestation === PrestationType.RETOUCHE) {
        const newAppointment = await this.prisma.appointment.create({
          data: {
            userId,
            title: appointmentTitle,
            prestation,
            start: effectiveStartDate,
            end: effectiveEndDate,
            tatoueurId: selectedTatoueur.tatoueurId ?? undefined,
            performerUserId: selectedTatoueur.performerUserId ?? undefined,
            clientId: client.id,
            clientUserId: clientUser?.id, // Lier au client connecté si applicable
            moodboardId: moodboardValidation.moodboardId,
            skin,
            status: appointmentStatus,
            visio: visio || false,
            visioRoom: generatedVisioRoom
          } as any,
        });
      
        // Gérer les détails spécifiques selon le type de prestation
        if (prestation === PrestationType.PIERCING) {
          // Pour les piercings, récupérer le prix automatiquement si possible
          let piercingPrice = rdvBody.price || rdvBody.estimatedPrice || 0;

          // Déterminer l'ID du service de piercing depuis les données du front
          let piercingServiceId = rdvBody.piercingServicePriceId;
          
          // Si pas d'ID direct, chercher dans les anciens champs
          if (!piercingServiceId) {
            piercingServiceId = rdvBody.piercingZoneOreille || 
            rdvBody.piercingZoneVisage || 
            rdvBody.piercingZoneBouche || 
            rdvBody.piercingZoneCorps || 
            rdvBody.piercingZoneMicrodermal;
          }

          if (piercingServiceId) {
            try {
              const piercingPriceConfig = await this.prisma.piercingServicePrice.findUnique({
                where: {
                  id: piercingServiceId,
                  userId,
                  isActive: true,
                },
                select: {
                  price: true,
                },
              });

              if (piercingPriceConfig) {
                piercingPrice = piercingPriceConfig.price;
              }
            } catch (priceError) {
              console.warn('⚠️ Erreur lors de la récupération du prix piercing par ID:', priceError);
            }
          }

          const tattooDetail = await this.prisma.tattooDetail.create({
            data: {
              appointmentId: newAppointment.id,
              clientId: client.id,
              description: rdvBody.description || '',
              zone: rdvBody.zone || '',
              size: rdvBody.size || '',
              colorStyle: rdvBody.colorStyle || '',
              reference: rdvBody.reference,
              sketch: rdvBody.sketch,
              // Champs spécifiques aux piercings
              piercingZone: rdvBody.piercingZone,
              piercingServicePriceId: piercingServiceId,
              estimatedPrice: rdvBody.estimatedPrice || piercingPrice,
              price: piercingPrice,
            },
          });

          // Mettre à jour l'appointment avec l'ID du tattooDetail
          await this.prisma.appointment.update({
            where: { id: newAppointment.id },
            data: { tattooDetailId: tattooDetail.id },
          });
        } else {
          // Pour les autres prestations (TATTOO, PROJET, RETOUCHE)
          const flashPrice = selectedFlash ? Math.max(0, Number(selectedFlash.price)) : null;

          const tattooDetail = await this.prisma.tattooDetail.create({
            data: {
              appointmentId: newAppointment.id,
              clientId: client.id,
              description: rdvBody.description || '',
              zone: rdvBody.zone || '',
              size: rdvBody.size || '',
              colorStyle: rdvBody.colorStyle || '',
              reference: rdvBody.reference,
              sketch: rdvBody.sketch,
              estimatedPrice:
                selectedFlash
                  ? (flashPrice ?? 0)
                  : prestation === PrestationType.PROJET
                  ? (projectPrice ?? 0)
                  : (rdvBody.estimatedPrice || 0),
              price:
                selectedFlash
                  ? (flashPrice ?? 0)
                  : prestation === PrestationType.PROJET
                  ? (projectPrice ?? 0)
                  : (rdvBody.price || 0),
            },
          });

          // Mettre à jour l'appointment avec l'ID du tattooDetail
          await this.prisma.appointment.update({
            where: { id: newAppointment.id },
            data: { tattooDetailId: tattooDetail.id },
          });
        }

        // Gestion des emails selon le statut
        if (salonConfig.addConfirmationEnabled) {
          // RDV en attente : mail au tatoueur uniquement
          await this.mailService.sendPendingAppointmentNotification(
            salonConfig.email,
            {
              recipientName: `${client.firstName} ${client.lastName}`,
              appointmentDetails: {
                date: newAppointment.start.toLocaleDateString('fr-FR', { 
                  weekday: 'long', 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                }),
                time: `${newAppointment.start.toLocaleTimeString('fr-FR', { 
                  hour: '2-digit', 
                  minute: '2-digit' 
                })} - ${newAppointment.end.toLocaleTimeString('fr-FR', { 
                  hour: '2-digit', 
                  minute: '2-digit' 
                })}`,
                service: newAppointment.prestation,
                title: newAppointment.title,
                clientEmail: client.email,
                clientPhone: client.phone,
                visio: visio || false,
                visioRoom: generatedVisioRoom
              }
            },
            salonConfig.salonName || undefined
          );
        } else {
          // RDV confirmé : mail au client et au tatoueur
          // Mail au client
          await this.mailService.sendAutoConfirmedAppointment(
            client.email,
            {
              recipientName: `${client.firstName} ${client.lastName}`,
              appointmentDetails: {
                date: newAppointment.start.toLocaleDateString('fr-FR', { 
                  weekday: 'long', 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                }),
                time: `${newAppointment.start.toLocaleTimeString('fr-FR', { 
                  hour: '2-digit', 
                  minute: '2-digit' 
                })} - ${newAppointment.end.toLocaleTimeString('fr-FR', { 
                  hour: '2-digit', 
                  minute: '2-digit' 
                })}`,
                service: newAppointment.prestation,
                title: newAppointment.title,
                tatoueur: artist?.name || 'À définir',
                visio: visio || false,
                visioRoom: generatedVisioRoom
              }
            },
            salonConfig.salonName || undefined
          );

          // Mail au tatoueur
          await this.mailService.sendNewAppointmentNotification(
            salonConfig.email,
            {
              recipientName: `${client.firstName} ${client.lastName}`,
              appointmentDetails: {
                date: newAppointment.start.toLocaleDateString('fr-FR', { 
                  weekday: 'long', 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                }),
                time: `${newAppointment.start.toLocaleTimeString('fr-FR', { 
                  hour: '2-digit', 
                  minute: '2-digit' 
                })} - ${newAppointment.end.toLocaleTimeString('fr-FR', { 
                  hour: '2-digit', 
                  minute: '2-digit' 
                })}`,
                service: newAppointment.prestation,
                title: newAppointment.title,
                tatoueur: artist?.name || 'À définir',
                clientEmail: client.email,
                clientPhone: client.phone,
                visio: visio || false,
                visioRoom: visio ? `${process.env.FRONTEND_URL || '#'}/meeting/${newAppointment.id}` : generatedVisioRoom
              }
            },
            salonConfig.salonName || undefined
          );
        }

        // Créer une conversation automatiquement dès qu'on a un userId côté client
        const conversationClientUserId = effectiveClientUserId || client.linkedUserId;

        if (conversationClientUserId) {
          const existingConversation = await this.prisma.conversation.findUnique({
            where: { appointmentId: newAppointment.id },
            select: { id: true },
          });

          if (existingConversation) {
            // Conversation déjà existante, pas de création
          } else {
            try {
              const prestationLabel = prestation === PrestationType.PROJET ? 'Projet tatouage' :
                prestation === PrestationType.TATTOO ? 'Tatouage' :
                prestation === PrestationType.PIERCING ? 'Piercing' :
                prestation === PrestationType.RETOUCHE ? 'Retouche' : prestation;
              const statusMessage = appointmentStatus === 'PENDING' 
                ? 'Votre demande de rendez-vous a bien été enregistrée et est en attente de confirmation par le salon.'
                : 'Votre rendez-vous a été confirmé automatiquement !';

              await this.conversationsService.createConversation(userId, {
                clientUserId: conversationClientUserId,
                appointmentId: newAppointment.id,
                subject: `RDV ${prestationLabel} - ${newAppointment.start.toLocaleDateString('fr-FR')}`,
                firstMessage: `Bonjour ${client.firstName}, ${statusMessage} N'hésitez pas à nous contacter pour toute question.`
              });
            } catch (conversationError) {
              console.error('⚠️ Erreur lors de la création de la conversation:', conversationError);
            }
          }
        }
      
        return {
          error: false,
          message: salonConfig.addConfirmationEnabled 
            ? `Rendez-vous ${prestation.toLowerCase()} créé en attente de confirmation.` 
            : `Rendez-vous ${prestation.toLowerCase()} créé avec succès.`,
          appointment: newAppointment,
          // tattooDetail,
          status: appointmentStatus,
        };
      }

      // Créer le rendez-vous
      const newAppointment = await this.prisma.appointment.create({
        data: {
          userId,
          title: appointmentTitle,
          prestation,
          start: new Date(start),
          end: new Date(end),
          tatoueurId: selectedTatoueur.tatoueurId ?? undefined,
          performerUserId: selectedTatoueur.performerUserId ?? undefined,
          clientId: client.id,
          clientUserId: clientUser?.id, // Lier au client connecté si applicable
          moodboardId: moodboardValidation.moodboardId,
          status: appointmentStatus,
          visio: visio || false,
          visioRoom: generatedVisioRoom
        },
        include: {
          tatoueur: {
            select: {
              name: true,
            },
          },
          performerUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              salonName: true,
            },
          },
        },
      });

      // Gestion des emails selon le statut
      if (salonConfig.addConfirmationEnabled) {
        // RDV en attente : mail au tatoueur uniquement
        await this.mailService.sendPendingAppointmentNotification(
          salonConfig.email,
          {
            recipientName: `${client.firstName} ${client.lastName}`,
            appointmentDetails: {
              date: newAppointment.start.toLocaleDateString('fr-FR', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
              }),
              time: `${newAppointment.start.toLocaleTimeString('fr-FR', { 
                hour: '2-digit', 
                minute: '2-digit' 
              })} - ${newAppointment.end.toLocaleTimeString('fr-FR', { 
                hour: '2-digit', 
                minute: '2-digit' 
              })}`,
              service: newAppointment.prestation,
              title: newAppointment.title,
              clientEmail: client.email,
              clientPhone: client.phone,
              visio: visio || false,
              visioRoom: generatedVisioRoom
            }
          },
          salonConfig.salonName || undefined
        );
      } else {
        // RDV confirmé : mail au client et au tatoueur
        // Mail au client
        await this.mailService.sendAutoConfirmedAppointment(
          client.email,
          {
            recipientName: `${client.firstName} ${client.lastName}`,
            appointmentDetails: {
              date: newAppointment.start.toLocaleDateString('fr-FR', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
              }),
              time: `${newAppointment.start.toLocaleTimeString('fr-FR', { 
                hour: '2-digit', 
                minute: '2-digit' 
              })} - ${newAppointment.end.toLocaleTimeString('fr-FR', { 
                hour: '2-digit', 
                minute: '2-digit' 
              })}`,
              service: newAppointment.prestation,
              title: newAppointment.title,
              tatoueur: artist?.name || 'À définir',
              visio: visio || false,
              visioRoom: generatedVisioRoom
            }
          },
          salonConfig.salonName || undefined
        );

        // Mail au tatoueur
        await this.mailService.sendNewAppointmentNotification(
          salonConfig.email,
          {
            recipientName: `${client.firstName} ${client.lastName}`,
            appointmentDetails: {
              date: newAppointment.start.toLocaleDateString('fr-FR', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
              }),
              time: `${newAppointment.start.toLocaleTimeString('fr-FR', { 
                hour: '2-digit', 
                minute: '2-digit' 
              })} - ${newAppointment.end.toLocaleTimeString('fr-FR', { 
                hour: '2-digit', 
                minute: '2-digit' 
              })}`,
              service: newAppointment.prestation,
              title: newAppointment.title,
              tatoueur: artist?.name || 'À définir',
              clientEmail: client.email,
              clientPhone: client.phone,
              visio: visio || false,
              visioRoom: visio ? `${process.env.FRONTEND_URL || '#'}/meeting/${newAppointment.id}` : generatedVisioRoom
            }
          },
          salonConfig.salonName || undefined
        );
      }

      // Créer une conversation automatiquement dès qu'on a un userId côté client
      const conversationClientUserId = effectiveClientUserId || client.linkedUserId;

      if (conversationClientUserId) {
        // Vérifier s'il existe déjà une conversation pour ce RDV
        const existingConversation = await this.prisma.conversation.findUnique({
          where: { appointmentId: newAppointment.id },
          select: { id: true },
        });

        if (existingConversation) {
          this.logger.log(`[Appointment] Conversation already exists for appointment ${newAppointment.id} (conversationId=${existingConversation.id}), skipping creation.`);
          console.log('[Appointment] Conversation already exists, skipping creation:', existingConversation.id);
        } else {
          try {
            const prestationLabel = prestation === PrestationType.PROJET ? 'Projet tatouage' :
              prestation === PrestationType.TATTOO ? 'Tatouage' :
              prestation === PrestationType.PIERCING ? 'Piercing' :
              prestation === PrestationType.RETOUCHE ? 'Retouche' : prestation;
            
            const statusMessage = appointmentStatus === 'PENDING' 
              ? `Votre demande de rendez-vous a bien été enregistrée et est en attente de confirmation par le salon.`
              : `Votre rendez-vous a été confirmé automatiquement !`;
            
            this.logger.log(`[Appointment] Creating conversation for clientUserId=${conversationClientUserId}, appointment=${newAppointment.id}`);
            console.log('[Appointment] Creating conversation for', conversationClientUserId, 'appointment', newAppointment.id);
            await this.conversationsService.createConversation(userId, {
              clientUserId: conversationClientUserId,
              appointmentId: newAppointment.id,
              subject: `RDV ${prestationLabel} - ${newAppointment.start.toLocaleDateString('fr-FR')}`,
              firstMessage: `Bonjour ${client.firstName}, ${statusMessage} N'hésitez pas à nous contacter pour toute question.`,
            });
            this.logger.log(`[Appointment] Conversation created successfully for appointment ${newAppointment.id}`);
            console.log('[Appointment] Conversation created successfully for appointment', newAppointment.id);
          } catch (conversationError) {
          
            console.error('⚠️ Erreur lors de la création de la conversation:', conversationError);
            // Ne pas faire échouer la création du RDV si la conversation échoue
          }
        }
      } else {
        this.logger.warn(`[Appointment] Aucun clientUserId résolu, conversation non créée (appointment=${newAppointment.id})`);
      }

      return {
        error: false,
        message: salonConfig.addConfirmationEnabled 
          ? `Rendez-vous créé en attente de confirmation.` 
          : `Rendez-vous créé avec succès.`,
        appointment: newAppointment,
        status: appointmentStatus,
      };
    } catch (error: unknown) {
      this.logger.error('createByClient failed', error as any);
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  } 

  //! ------------------------------------------------------------------------------

  //! RECUPERER TOUS LES RDV D'UN CLIENT

  //! ------------------------------------------------------------------------------
  async getAllRdvForClient({userId, status, page = 1, limit = 10}: {userId: string, status?: string, page?: number, limit?: number}): Promise<Record<string, any>> {
    try {
      const currentPage = Math.max(1, Number(page) || 1);
      const perPage = Math.min(50, Math.max(1, Number(limit) || 10));
      const skip = (currentPage - 1) * perPage;

      const cacheKey = `client:appointments:${userId}:${JSON.stringify({
        status: status?.trim() || null,
        page: currentPage,
        limit: perPage
      })}`;

      try {
        const cachedAppointments = await this.cacheService.get<{
          error: boolean;
          appointments: Record<string, any>[];
          pagination: Record<string, any>;
          message: string;
        }>(cacheKey);
        if (cachedAppointments) {
          return cachedAppointments;
        }
      } catch (cacheError) {
        console.warn('Erreur cache Redis pour getAllRdvForClient:', cacheError);
      }

      const whereClause: Record<string, any> = {
        clientUserId: userId,
      };

      if (status && status.trim() !== '') {
        whereClause.status = status.toUpperCase();
      }

      const [totalAppointments, appointments] = await this.prisma.$transaction([
        this.prisma.appointment.count({ where: whereClause }),
        this.prisma.appointment.findMany({
          where: whereClause,
          select: {
            id: true,
            title: true,
            prestation: true,
            start: true,
            end: true,
            status: true,
            isPayed: true,
            createdAt: true,
            updatedAt: true,
            visio: true,
            visioRoom: true,
            user: {
              select: {
                id: true,
                salonName: true,
                firstName: true,
                lastName: true,
                image: true,
                city: true,
                postalCode: true,
                phone: true,
                address: true,
                instagram: true,
                website: true
              }
            },
            tatoueur: {
              select: {
                id: true,
                name: true,
                img: true,
                phone: true,
                instagram: true
              }
            },
            performerUser: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                salonName: true,
              },
            },
            tattooDetail: {
              select: {
                id: true,
                description: true,
                zone: true,
                size: true,
                colorStyle: true,
                reference: true,
                sketch: true,
                piercingZone: true,
                estimatedPrice: true,
                price: true,
                piercingServicePrice: {
                  select: {
                    description: true,
                    piercingZoneOreille: true,
                    piercingZoneVisage: true,
                    piercingZoneBouche: true,
                    piercingZoneCorps: true,
                    piercingZoneMicrodermal: true
                  }
                }
              }
            },
            conversation: {
              select: {
                id: true,
                lastMessageAt: true,
                notifications: {
                  where: {
                    userId: userId
                  },
                  select: {
                    unreadCount: true
                  }
                }
              }
            },
            salonReview: {
              select: {
                id: true,
                rating: true,
                title: true,
                comment: true,
                photos: true,
                isVerified: true,
                isVisible: true,
                createdAt: true,
                salonResponse: true,
                salonRespondedAt: true
              }
            },
            moodboard: {
              select: { id: true, name: true, description: true }
            }
          },
          orderBy: {
            start: 'desc'
          },
          skip,
          take: perPage,
        })
      ]);

      const formattedAppointments = appointments.map(appointment => ({
        id: appointment.id,
        title: appointment.title,
        prestation: appointment.prestation,
        start: appointment.start,
        end: appointment.end,
        status: appointment.status,
        isPayed: appointment.isPayed,
        visio: appointment.visio,
        visioRoom: appointment.visioRoom,
        createdAt: appointment.createdAt,
        updatedAt: appointment.updatedAt,
        duration: appointment.end && appointment.start
          ? Math.round((appointment.end.getTime() - appointment.start.getTime()) / (1000 * 60))
          : 0,
        salon: {
          id: appointment.user.id,
          salonName: appointment.user.salonName,
          firstName: appointment.user.firstName,
          lastName: appointment.user.lastName,
          image: appointment.user.image,
          city: appointment.user.city,
          postalCode: appointment.user.postalCode,
          phone: appointment.user.phone,
          address: appointment.user.address,
          instagram: appointment.user.instagram,
          website: appointment.user.website
        },
        tatoueur: appointment.tatoueur ? {
          id: appointment.tatoueur.id,
          name: appointment.tatoueur.name,
          img: appointment.tatoueur.img,
          phone: appointment.tatoueur.phone,
          instagram: appointment.tatoueur.instagram
        } : appointment.performerUser ? {
          id: appointment.performerUser.id,
          name: this.getPerformerDisplayName(appointment.performerUser),
          img: null,
          phone: null,
          instagram: null,
        } : null,
        prestationDetails: appointment.tattooDetail ? {
          id: appointment.tattooDetail.id,
          description: appointment.tattooDetail.description,
          zone: appointment.tattooDetail.zone,
          size: appointment.tattooDetail.size,
          colorStyle: appointment.tattooDetail.colorStyle,
          reference: appointment.tattooDetail.reference,
          sketch: appointment.tattooDetail.sketch,
          piercingZone: appointment.tattooDetail.piercingZone,
          estimatedPrice: appointment.tattooDetail.estimatedPrice,
          price: appointment.tattooDetail.price,
          piercingDetails: appointment.tattooDetail.piercingServicePrice ? {
            description: appointment.tattooDetail.piercingServicePrice.description,
            zoneOreille: appointment.tattooDetail.piercingServicePrice.piercingZoneOreille,
            zoneVisage: appointment.tattooDetail.piercingServicePrice.piercingZoneVisage,
            zoneBouche: appointment.tattooDetail.piercingServicePrice.piercingZoneBouche,
            zoneCorps: appointment.tattooDetail.piercingServicePrice.piercingZoneCorps,
            zoneMicrodermal: appointment.tattooDetail.piercingServicePrice.piercingZoneMicrodermal
          } : null
        } : null,
        conversation: appointment.conversation ? {
          id: appointment.conversation.id,
          lastMessageAt: appointment.conversation.lastMessageAt,
          isRead: (appointment.conversation.notifications?.[0]?.unreadCount ?? 0) === 0,
          unreadCount: appointment.conversation.notifications?.[0]?.unreadCount ?? 0
        } : null,
        review: appointment.salonReview ? {
          id: appointment.salonReview.id,
          rating: appointment.salonReview.rating,
          title: appointment.salonReview.title,
          comment: appointment.salonReview.comment,
          photos: appointment.salonReview.photos,
          isVerified: appointment.salonReview.isVerified,
          isVisible: appointment.salonReview.isVisible,
          createdAt: appointment.salonReview.createdAt,
          salonResponse: appointment.salonReview.salonResponse,
          salonRespondedAt: appointment.salonReview.salonRespondedAt
        } : null,
        moodboard: appointment.moodboard ? {
          id: appointment.moodboard.id,
          name: appointment.moodboard.name,
          description: appointment.moodboard.description
        } : null
      }));

      const totalPages = Math.ceil(totalAppointments / perPage);
      const startIndex = totalAppointments === 0 ? 0 : skip + 1;
      const endIndex = Math.min(skip + perPage, totalAppointments);

      const result = {
        error: false,
        appointments: formattedAppointments,
        pagination: {
          currentPage,
          limit: perPage,
          totalAppointments,
          totalPages,
          hasNextPage: currentPage < totalPages,
          hasPreviousPage: currentPage > 1,
          startIndex,
          endIndex,
        },
        message: `${formattedAppointments.length} rendez-vous sur ${totalAppointments} récupéré(s) avec succès.`
      };

      try {
        const ttl = 10 * 60;
        await this.cacheService.set(cacheKey, result, ttl);
      } catch (cacheError) {
        console.warn('Erreur sauvegarde cache Redis pour getAllRdvForClient:', cacheError);
      }

      return result;

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: `Erreur lors de la récupération des rendez-vous: ${errorMessage}`,
      };
    }
  }

  //! ------------------------------------------------------------------------------

  //! VOIR TOUS LES RDV

  //! ------------------------------------------------------------------------------
  async getAllAppointments(id: string) {
    try {
      const appointments = await this.prisma.appointment.findMany({
        where: {
          userId: id,
        },
        include: {
          tattooDetail: true,
          tatoueur: {
            select: {
              id: true,
              name: true,
            },
          },
          performerUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              salonName: true,
            },
          },
        },
      });
      return this.normalizeAppointmentsTatoueur(appointments);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! ------------------------------------------------------------------------------

  //! VOIR TOUS LES RDV PAR DATE

  //! ------------------------------------------------------------------------------
  async getAppointmentsByDateRange(userId: string, startDate: string, endDate: string, page: number = 1, limit: number = 5) {
    try {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const skip = (page - 1) * limit;
      const scopedWhere = await this.buildScopedAppointmentWhere(userId, {
        start: {
          gte: start,
          lt: end,
        },
      });

      // Créer une clé de cache basée sur les paramètres
      const cacheKey = `appointments:date-range:${userId}:${JSON.stringify({
        startDate,
        endDate,
        page,
        limit
      })}`;

      // 1. Vérifier dans Redis
      const cachedResult = await this.cacheService.get<{
        error: boolean;
        appointments: any[];
        pagination: any;
      }>(cacheKey);
      
      if (cachedResult) {
        cachedResult.appointments = this.normalizeAppointmentsTatoueur(cachedResult.appointments);
        return cachedResult;
      }

      // Compter le total des rendez-vous dans la plage de dates
      const totalAppointments = await this.prisma.appointment.count({
        where: scopedWhere,
      });
  
      const appointments = await this.prisma.appointment.findMany({
        where: scopedWhere,
        include: {
          client: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
          tattooDetail: true,
          tatoueur: {
            select: {
              id: true,
              name: true,
            },
          },
          performerUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              salonName: true,
            },
          },
          moodboard: {
            select: { id: true, name: true, description: true },
          },
        },
        orderBy: {
          start: 'desc', // Trier par date décroissante
        },
        skip,
        take: limit,
      });

      const totalPages = Math.ceil(totalAppointments / limit);

      const result = {
        error: false,
        appointments: this.normalizeAppointmentsTatoueur(appointments),
        pagination: {
          currentPage: page,
          totalPages,
          totalAppointments,
          limit,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      };

      // 3. Mettre en cache (TTL 5 minutes pour les listes par date)
      await this.cacheService.set(cacheKey, result, 300);

      return result;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! ------------------------------------------------------------------------------

  //! VOIR TOUS LES RDV D'UN SALON

  //! ------------------------------------------------------------------------------
  async getAllAppointmentsBySalon(
    salonId: string, 
    page: number = 1, 
    limit: number = 5,
    status?: string,
    period?: 'upcoming' | 'past',
    tatoueurId?: string,
    prestation?: string,
    search?: string
  ) {
    try {
      const skip = (page - 1) * limit;
      const visibilityWhere = await this.buildScopedAppointmentWhere(salonId);

      // Créer une clé de cache basée sur les paramètres incluant les filtres
      const cacheKey = `appointments:salon:${salonId}:${JSON.stringify({
        page,
        limit,
        status,
        period,
        tatoueurId,
        prestation,
        search
      })}`;

      // 1. Vérifier dans Redis
      const cachedResult = await this.cacheService.get<{
        error: boolean;
        appointments: any[];
        pagination: any;
        allTatoueurs: any[];
        allPrestations: string[];
      }>(cacheKey);
      
      if (cachedResult) {
        cachedResult.appointments = this.normalizeAppointmentsTatoueur(cachedResult.appointments);
        return cachedResult;
      }

      // Construire les conditions de filtrage
      const now = new Date();
      const andConditions: Prisma.AppointmentWhereInput[] = [];

      // Filtre par statut
      if (status && Object.values(AppointmentStatus).includes(status as AppointmentStatus)) {
        andConditions.push({ status: status as AppointmentStatus });
      }

      // Filtre par période (à venir ou passée)
      if (period === 'upcoming') {
        andConditions.push({ start: { gte: now } });
      } else if (period === 'past') {
        andConditions.push({ start: { lt: now } });
      }

      // Filtre par tatoueur
      if (tatoueurId) {
        const resolvedTatoueurId = this.normalizeTatoueurSelectionId(tatoueurId);
        andConditions.push({
          OR: [
            { tatoueurId: resolvedTatoueurId },
            { performerUserId: resolvedTatoueurId },
          ],
        });
      }

      // Filtre par type de prestation
      if (prestation && Object.values(PrismaPrestationType).includes(prestation as PrismaPrestationType)) {
        andConditions.push({ prestation: prestation as PrismaPrestationType });
      }

      // Filtre de recherche par nom/prénom du client et titre
      if (search) {
        andConditions.push({
          OR: [
            {
              client: {
                firstName: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
            },
            {
              client: {
                lastName: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
            },
            {
              title: {
                contains: search,
                mode: 'insensitive',
              },
            },
          ],
        });
      }

      const whereConditions: Prisma.AppointmentWhereInput = {
        AND: [visibilityWhere, ...andConditions],
      };

      // Récupérer en parallèle : les RDV filtrés, le total, tous les tatoueurs et toutes les prestations
      const [appointments, totalAppointments, allTatoueurs, allPrestationsResult] = await Promise.all([
        // Rendez-vous filtrés avec pagination
        this.prisma.appointment.findMany({
          where: whereConditions,
          include: {
            tatoueur: {
              select: {
                id: true,
                name: true,
              },
            },
            performerUser: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                salonName: true,
              },
            },
            salonReview: true,
            tattooDetail: true,
            client: {
              select: {
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
              },
            },
            conversation: {
              select: {
                id: true,
              },
            },
            moodboard: {
              select: { id: true, name: true, description: true },
            },
          },
          orderBy: {
            start: 'desc',
          },
          skip,
          take: limit,
        }),
        // Total des RDV correspondant aux filtres
        this.prisma.appointment.count({
          where: whereConditions,
        }),
        // Tous les tatoueurs du salon (pour les filtres)
        this.prisma.tatoueur.findMany({
          where: {
            userId: salonId,
          },
          select: {
            id: true,
            name: true,
          },
          orderBy: {
            name: 'asc',
          },
        }),
        // Toutes les prestations utilisées par le salon (pour les filtres)
        this.prisma.appointment.findMany({
          where: {
            ...visibilityWhere,
          },
          select: {
            prestation: true,
          },
          distinct: ['prestation'],
        }),
      ]);

      // Extraire les prestations uniques
      const allPrestations = allPrestationsResult.map(a => a.prestation).filter(Boolean);

      const totalPages = Math.ceil(totalAppointments / limit);

      const result = {
        error: false,
        appointments: this.normalizeAppointmentsTatoueur(appointments),
        pagination: {
          currentPage: page,
          totalPages,
          totalAppointments,
          limit,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
        allTatoueurs, // Tous les tatoueurs pour les filtres
        allPrestations, // Tous les types de rdv pour les filtres
      };

      // 3. Mettre en cache (TTL 5 minutes)
      await this.cacheService.set(cacheKey, result, 300);

      return result;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! ------------------------------------------------------------------------------

  //! RECUPERER LES RDV D'UN TATOUEUR PAR DATE 

  //! ------------------------------------------------------------------------------
  async getAppointmentsByTatoueurRange(tatoueurId: string, startDate: string, endDate: string) {
    try {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const resolvedTatoueurId = this.normalizeTatoueurSelectionId(tatoueurId);

      const tatoueurContext = await this.prisma.tatoueur.findUnique({
        where: { id: resolvedTatoueurId },
        select: {
          userId: true,
          user: {
            select: {
              role: true,
              saasPlan: true,
              saasPlanDetails: {
                select: {
                  currentPlan: true,
                  agendaMode: true,
                },
              },
            },
          },
        },
      });

      if (!tatoueurContext) {
        const linkedUser = await this.prisma.user.findUnique({
          where: {
            id: resolvedTatoueurId,
          },
          select: {
            id: true,
            role: true,
          },
        });

        if (!linkedUser || linkedUser.role !== 'user_tatoueur') {
          return [];
        }

        const appointments = await this.prisma.appointment.findMany({
          where: {
            status: {
              not: 'CANCELED',
            },
            start: {
              gte: start,
              lt: end,
            },
            OR: [
              { userId: linkedUser.id },
              { performerUserId: linkedUser.id },
            ],
          },
          select: {
            start: true,
            end: true,
          },
        });

        return appointments ?? [];
      }

      const agendaMode = this.resolveAppointmentAgendaMode({
        role: tatoueurContext.user?.role,
        agendaMode: tatoueurContext.user?.saasPlanDetails?.agendaMode,
      });

      const whereConditions: Record<string, any> = {
        status: {
          not: 'CANCELED', // Exclure les rendez-vous annulés
        },
        start: {
          gte: start,
          lt: end,
        },
      };

      if (agendaMode === AgendaMode.GLOBAL) {
        whereConditions.userId = tatoueurContext.userId;
      } else {
        whereConditions.OR = [
          { tatoueurId: resolvedTatoueurId },
          { performerUserId: resolvedTatoueurId },
        ];
      }

      const appointments = await this.prisma.appointment.findMany({
        where: whereConditions,
        select: {
          start: true,
          end: true,
        },
      });

      console.log("RDV récupérés pour le tatoueur", tatoueurId, "entre", startDate, "et", endDate, ":", appointments);

    return appointments ?? [];
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return {
      error: true,
      message: errorMessage,
    };
  }
}

  //! ------------------------------------------------------------------------------

  //! RECUPERER LES RDV D'UN SALON PAR DATE 

  //! ------------------------------------------------------------------------------
  async getAppointmentsBySalonRange(salonId: string, startDate: string, endDate: string) {
    try {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const scopedWhere = await this.buildScopedAppointmentWhere(salonId, {
        status: {
          not: 'CANCELED',
        },
        start: {
          gte: start,
          lt: end,
        },
      });

      const appointments = await this.prisma.appointment.findMany({
        where: scopedWhere,
        select: {
          id: true,
          start: true,
          end: true,
          title: true,
          prestation: true,
          skin: true,
          status: true,
          conversation: {
            select: {
              id: true,
            },
          },
          tatoueur: {
            select: {
              id: true,
              name: true,
            },
          },
          performerUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              salonName: true,
            },
          },
        } as any,
      });

      return this.normalizeAppointmentsTatoueur(appointments ?? []);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! ------------------------------------------------------------------------------

  //! VOIR UN SEUL RDV

  //! ------------------------------------------------------------------------------
  async getOneAppointment(id: string) {
    try {
      const cacheKey = `appointment:${id}`;

      // 1. Vérifier dans Redis
      const cachedAppointment = await this.cacheService.get<{
        id: string;
        title: string;
        start: Date;
        end: Date;
        [key: string]: any;
      }>(cacheKey);
      
      if (cachedAppointment) {
        return this.normalizeAppointmentTatoueur(cachedAppointment);
      }

      // 2. Sinon, aller chercher en DB
      const appointment = await this.prisma.appointment.findUnique({
        where: {
          id,
        },
        include: {
          tatoueur: true,
          performerUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              salonName: true,
            },
          },
          tattooDetail: true,
          appointmentConsumables: {
            orderBy: {
              createdAt: 'desc',
            },
          },
          salonReview: true,
          moodboard: {
            select: { id: true, name: true, description: true },
          },
        },
      });

      // 3. Mettre en cache si trouvé (TTL 10 minutes pour un RDV spécifique)
      if (appointment) {
        const normalizedAppointment = this.normalizeAppointmentTatoueur(appointment);
        await this.cacheService.set(cacheKey, normalizedAppointment, 600);
        return normalizedAppointment;
      }

      return appointment;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! ------------------------------------------------------------------------------

  //! SUPPRIMER UN RDV

  //! ------------------------------------------------------------------------------
  async deleteAppointment(id: string) {
    try {
      // Récupérer le RDV avant suppression pour l'invalidation du cache
      const appointmentToDelete = await this.prisma.appointment.findUnique({
        where: { id },
        select: { 
          userId: true,
          start: true,
          isPayed: true
        }
      });

      if (!appointmentToDelete) {
        return {
          error: true,
          message: 'Rendez-vous introuvable.',
        };
      }

      const appointment = await this.prisma.appointment.delete({
        where: {
          id,
        },
      });

      // Invalider le cache après suppression
      await this.cacheService.del(`appointment:${id}`);
      await this.cacheService.delPattern(`appointments:salon:${appointmentToDelete.userId}:*`);
      await this.cacheService.delPattern(`appointments:date-range:${appointmentToDelete.userId}:*`);

      // Invalider le cache du dashboard
      await this.invalidateDashboardCache(appointmentToDelete.userId, { 
        start: appointmentToDelete.start, 
        isPayed: appointmentToDelete.isPayed 
      });

      return appointment;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  // ! -------------------------------------------------------------------------

  // ! MODIFIER UN RDV

  //! ------------------------------------------------------------------------------
  async updateAppointment(id: string, rdvBody: UpdateAppointmentDto) {
    try {
      const { title, prestation, start, end, tatoueurId, skin } = rdvBody;
      const tattooDetail: Partial<UpdateAppointmentDto['tattooDetail']> = rdvBody.tattooDetail || {};
      const { description = '', zone = '', size = '', colorStyle = '', reference = '', sketch = '', estimatedPrice = 0, price = 0 } = tattooDetail;

      // Récupérer le rendez-vous existant avec les informations du client
      const existingAppointment = await this.prisma.appointment.findUnique({
        where: { id },
        include: {
          client: true,
          tatoueur: true,
        },
      });

      if (!existingAppointment) {
        return {
          error: true,
          message: 'Rendez-vous introuvable.',
        };
      }

      const resolvedPrestation = prestation ?? existingAppointment.prestation;
      const existingSkin = 'skin' in existingAppointment ? (existingAppointment as { skin?: string | null }).skin : undefined;
      const resolvedSkin = skin ?? existingSkin;
      const skinValidationError = this.validateSkinToneForPrestation(resolvedPrestation, resolvedSkin);
      if (skinValidationError) {
        return {
          error: true,
          message: skinValidationError,
        };
      }

      // Vérifier si le tatoueur existe (interne ou profil user_tatoueur lié)
      const selectedTatoueur = await this.resolveTatoueurSelection(tatoueurId);

      if (!selectedTatoueur.artist) {
        return {
          error: true,
          message: 'Tatoueur introuvable.',
        };
      }

      const artist = selectedTatoueur.artist;

      const salon = await this.prisma.user.findUnique({
        where: { id: existingAppointment.userId },
        select: {
          role: true,
          saasPlan: true,
          saasPlanDetails: {
            select: {
              currentPlan: true,
              agendaMode: true,
            },
          },
        },
      });

      const agendaMode = this.resolveAppointmentAgendaMode({
        role: salon?.role,
        agendaMode: salon?.saasPlanDetails?.agendaMode,
      });

      const conflictingAppointment = await this.findAppointmentConflict({
        userId: existingAppointment.userId,
        start: new Date(start),
        end: new Date(end),
        tatoueurId: selectedTatoueur.tatoueurId,
        performerUserId: selectedTatoueur.performerUserId,
        agendaMode,
        excludedAppointmentId: id,
      });

      if (conflictingAppointment) {
        return {
          error: true,
          message: 'Ce créneau horaire est déjà réservé.',
        };
      }

      // Mettre à jour le rendez-vous
      const updatedAppointment = await this.prisma.appointment.update({
        where: {
          id,
        },
        data: {
          title,
          prestation,
          start: new Date(start),
          end: new Date(end),
          tatoueurId: selectedTatoueur.tatoueurId,
          performerUserId: selectedTatoueur.performerUserId,
          skin,
        } as any,
        include: {
          client: true,
          tatoueur: true,
          performerUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              salonName: true,
            },
          },
        },
      });

      // Mettre à jour les détails du tatouage s'ils existent
      if (tattooDetail) {
        await this.prisma.tattooDetail.upsert({
          where: { appointmentId: id },
          update: {
            description,
            zone,
            size,
            colorStyle,
            reference,
            sketch,
            estimatedPrice,
            price,
          },
          create: {
            appointmentId: id,
            clientId: existingAppointment.clientId, // ← AJOUT DU clientId manquant
            description,
            zone,
            size,
            colorStyle,
            reference,
            sketch,
            estimatedPrice,
            price,
          },
        });
      }

      // Vérifier si les horaires ont changé
      const originalStart = existingAppointment.start.toISOString();
      const originalEnd = existingAppointment.end.toISOString();
      const newStart = new Date(start).toISOString();
      const newEnd = new Date(end).toISOString();

      // Envoi d'un mail de confirmation si les horaires ont changé
      if ((originalStart !== newStart || originalEnd !== newEnd) && existingAppointment.client?.email) {
        // Récupérer les informations du salon
        const salon = await this.prisma.user.findUnique({
          where: { id: existingAppointment.userId },
          select: { salonName: true }
        });

        await this.mailService.sendAppointmentModification(
          existingAppointment.client.email,
          {
            recipientName: `${existingAppointment.client.firstName} ${existingAppointment.client.lastName}`,
            appointmentDetails: {
              date: updatedAppointment.start.toLocaleDateString('fr-FR', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
              }),
              time: `${updatedAppointment.start.toLocaleTimeString('fr-FR', { 
                hour: '2-digit', 
                minute: '2-digit' 
              })} - ${updatedAppointment.end.toLocaleTimeString('fr-FR', { 
                hour: '2-digit', 
                minute: '2-digit' 
              })}`,
              service: updatedAppointment.prestation,
              tatoueur: artist.name,
              visio: updatedAppointment.visio || false,
              visioRoom: updatedAppointment.visio ? `${process.env.FRONTEND_URL || '#'}/meeting/${updatedAppointment.id}` : updatedAppointment.visioRoom || undefined
            }
          },
          salon?.salonName || undefined
        );
      }

      // Invalider le cache après update
      await this.cacheService.del(`appointment:${id}`);
      await this.cacheService.delPattern(`appointments:salon:${existingAppointment.userId}:*`);
      await this.cacheService.delPattern(`appointments:date-range:${existingAppointment.userId}:*`);

      // Invalider le cache du dashboard
      await this.invalidateDashboardCache(existingAppointment.userId, { 
        start: updatedAppointment.start, 
        isPayed: updatedAppointment.isPayed 
      });

      return {
        error: false,
        message: 'Rendez-vous mis à jour avec succès.',
        appointment: this.normalizeAppointmentTatoueur(updatedAppointment),
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! ------------------------------------------------------------------------------

  //! MODIFIER UN RDV PAR LE CLIENT

  //! ------------------------------------------------------------------------------
  async updateAppointmentByClient(appointmentId: string, userId: string, rdvBody: { start: string; end: string; tatoueurId?: string }) {
    try {
      // Récupérer le RDV avec toutes les informations nécessaires
      const existingAppointment = await this.prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          client: true,
          tatoueur: true,
          user: {
            select: {
              role: true,
              salonName: true,
              email: true,
              addConfirmationEnabled: true,
              saasPlan: true,
              saasPlanDetails: {
                select: {
                  currentPlan: true,
                  agendaMode: true,
                },
              },
            },
          },
        },
      });

      if (!existingAppointment) {
        return {
          error: true,
          message: 'Rendez-vous introuvable.',
        };
      }

      // Vérifier que le client connecté est bien le propriétaire du RDV
      if (existingAppointment.clientUserId !== userId) {
        return {
          error: true,
          message: 'Vous n\'avez pas le droit de modifier ce rendez-vous.',
        };
      }

      // Vérifier que le RDV n'est pas déjà terminé ou complet
      if (['COMPLETED', 'NO_SHOW', 'CANCELED'].includes(existingAppointment.status)) {
        return {
          error: true,
          message: 'Vous ne pouvez pas modifier un rendez-vous terminé, annulé ou complété.',
        };
      }

      const { start, end, tatoueurId } = rdvBody;

      // Vérifier si le tatoueur existe si fourni
      if (tatoueurId && tatoueurId !== existingAppointment.tatoueurId) {
        const artist = await this.prisma.tatoueur.findUnique({
          where: { id: tatoueurId },
        });

        if (!artist) {
          return {
            error: true,
            message: 'Tatoueur introuvable.',
          };
        }
      }

      const agendaMode = this.resolveAppointmentAgendaMode({
        role: existingAppointment.user?.role,
        agendaMode: existingAppointment.user?.saasPlanDetails?.agendaMode,
      });

      const conflictingAppointment = await this.findAppointmentConflict({
        userId: existingAppointment.userId,
        start: new Date(start),
        end: new Date(end),
        tatoueurId: tatoueurId || existingAppointment.tatoueurId,
        agendaMode,
        excludedAppointmentId: appointmentId,
      });

      if (conflictingAppointment) {
        return {
          error: true,
          message: 'Ce créneau horaire est déjà réservé.',
        };
      }

      // Déterminer le nouveau statut selon le paramètre addConfirmationEnabled du salon
      const newAppointmentStatus = existingAppointment.user.addConfirmationEnabled ? 'PENDING' : existingAppointment.status;

      // Mettre à jour le rendez-vous (dates, heure et tatoueur)
      const updatedAppointment = await this.prisma.appointment.update({
        where: { id: appointmentId },
        data: {
          start: new Date(start),
          end: new Date(end),
          tatoueurId: tatoueurId || existingAppointment.tatoueurId,
          status: newAppointmentStatus,
        },
        include: {
          client: true,
          tatoueur: true,
        },
      });

      // Envoyer un email de confirmation au client
      if (updatedAppointment.client) {
        try {
          await this.mailService.sendAppointmentModification(
            updatedAppointment.client.email,
            {
              recipientName: `${updatedAppointment.client.firstName} ${updatedAppointment.client.lastName}`,
              appointmentDetails: {
                date: updatedAppointment.start.toLocaleDateString('fr-FR', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                }),
                time: `${updatedAppointment.start.toLocaleTimeString('fr-FR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })} - ${updatedAppointment.end.toLocaleTimeString('fr-FR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}`,
                service: updatedAppointment.prestation,
                tatoueur: updatedAppointment.tatoueur?.name || 'Non assigné',
                visio: updatedAppointment.visio || false,
                visioRoom: updatedAppointment.visio
                  ? `${process.env.FRONTEND_URL || '#'}/meeting/${updatedAppointment.id}`
                  : updatedAppointment.visioRoom || undefined,
              },
            },
            existingAppointment.user?.salonName || undefined,
            existingAppointment.user?.email || undefined
          );
        } catch (emailError) {
          console.error('⚠️ Erreur lors de l\'envoi de l\'email au client:', emailError);
        }
      }

      // Envoyer un email de notification au salon
      if (existingAppointment.user?.email && updatedAppointment.client) {
        try {
          const clientName = `${updatedAppointment.client.firstName} ${updatedAppointment.client.lastName}`;
          
          // Formater les dates
          const appointmentDate = updatedAppointment.start.toLocaleDateString('fr-FR', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          });
          
          const appointmentTime = `${updatedAppointment.start.toLocaleTimeString('fr-FR', {
            hour: '2-digit',
            minute: '2-digit'
          })} - ${updatedAppointment.end.toLocaleTimeString('fr-FR', {
            hour: '2-digit',
            minute: '2-digit'
          })}`;

          // Créer un message personnalisé pour le salon
          const statusInfo = newAppointmentStatus === 'PENDING'
            ? '⚠️ Ce rendez-vous est en attente de votre confirmation.'
            : '✅ Ce rendez-vous a été automatiquement confirmé.';

          const emailBody = `
            <strong>${clientName}</strong> a modifié son rendez-vous.
            <br><br>
            ${statusInfo}
            <br><br>
            <strong>📅 Nouveaux détails du rendez-vous :</strong>
            <br><br>
            📅 <strong>Date :</strong> ${appointmentDate}
            <br>
            ⏰ <strong>Heure :</strong> ${appointmentTime}
            <br>
            🎨 <strong>Prestation :</strong> ${updatedAppointment.prestation}
            <br>
            👨‍🎨 <strong>Artiste :</strong> ${updatedAppointment.tatoueur?.name || 'Non assigné'}
            <br><br>
            👤 <strong>Informations client :</strong>
            <br>
            Nom : ${clientName}
            <br>
            Email : ${updatedAppointment.client.email}
            <br>
            Téléphone : ${updatedAppointment.client.phone || 'Non renseigné'}
          `;

          await this.mailService.sendCustomEmail(
            existingAppointment.user.email,
            '🔔 Modification de rendez-vous par un client',
            {
              recipientName: existingAppointment.user.salonName || 'Salon',
              customMessage: emailBody,
            },
            existingAppointment.user.salonName || undefined,
            existingAppointment.user.email
          );
        } catch (emailError) {
          console.error('⚠️ Erreur lors de l\'envoi de l\'email au salon:', emailError);
        }
      }

      // Invalider le cache après modification
      await this.cacheService.del(`appointment:${appointmentId}`);
      await this.cacheService.delPattern(`appointments:salon:${existingAppointment.userId}:*`);
      await this.cacheService.delPattern(`appointments:date-range:${existingAppointment.userId}:*`);
      await this.cacheService.delPattern(`client:appointments:${userId}:*`);

      // Invalider le cache du dashboard
      await this.invalidateDashboardCache(existingAppointment.userId, {
        start: updatedAppointment.start,
        isPayed: updatedAppointment.isPayed,
      });

      return {
        error: false,
        message: newAppointmentStatus === 'PENDING'
          ? 'Rendez-vous modifié et en attente de confirmation du salon.'
          : 'Rendez-vous modifié avec succès.',
        appointment: updatedAppointment,
        status: newAppointmentStatus,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! ------------------------------------------------------------------------------

  //! CONFIRMER UN RDV

  //! ------------------------------------------------------------------------------
  async confirmAppointment(id: string, message: string) {
    try {
    // Récupérer le rendez-vous avec les informations du client et du tatoueur
    const existingAppointment = await this.prisma.appointment.findUnique({
      where: { id },
      include: {
        client: true,
        tatoueur: true,
      },
    });

    if (!existingAppointment) {
      return {
        error: true,
        message: 'Rendez-vous introuvable.',
      };
    }

      const appointment = await this.prisma.appointment.update({
        where: {
          id,
        },
        data: {
          status: 'CONFIRMED',
        },
        include: {
          client: true,
          tatoueur: {
            select: {
              name: true,
            },
          },
      },
      });

      // Récupérer les informations du salon
      const salon = await this.prisma.user.findUnique({
        where: { id: existingAppointment.userId },
        select: { salonName: true, email: true }
      });

      // Créer une conversation si le client connecté existe (clientUserId)
      if (existingAppointment.clientUserId) {
        try {
          await this.conversationsService.createConversation(
            existingAppointment.userId, // salonId
            {
              clientUserId: existingAppointment.clientUserId,
              appointmentId: appointment.id,
              subject: `Rendez-vous ${appointment.prestation}`,
              firstMessage: `Bonjour ${appointment.client?.firstName}, votre rendez-vous a été confirmé ! N'hésitez pas à nous contacter pour toute question.`,
            }
          );
        } catch (conversationError) {
          // Log mais ne bloque pas la confirmation du RDV
          console.error('Erreur lors de la création de la conversation:', conversationError);
        }
      }

      // Envoi d'un mail de confirmation au client (si le client existe)
      if (appointment.client) {
        await this.mailService.sendAppointmentConfirmation(
          appointment.client.email,
          {
            recipientName: `${appointment.client.firstName} ${appointment.client.lastName}`,
            appointmentDetails: {
              date: appointment.start.toLocaleDateString('fr-FR', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
              }),
              time: `${appointment.start.toLocaleTimeString('fr-FR', { 
                hour: '2-digit', 
                minute: '2-digit' 
              })} - ${appointment.end.toLocaleTimeString('fr-FR', { 
                hour: '2-digit', 
                minute: '2-digit' 
              })}`,
              service: appointment.prestation,
              tatoueur: appointment.tatoueur?.name || 'Non assigné',
              title: appointment.title,
              visio: appointment.visio || false,
              visioRoom: appointment.visio ? `${process.env.FRONTEND_URL || '#'}/meeting/${appointment.id}` : appointment.visioRoom || undefined
            },
            customMessage: message || undefined
          },
          salon?.salonName || undefined,
          salon?.email || undefined
        );
    }

      // Invalider le cache après confirmation
      await this.cacheService.del(`appointment:${id}`);
      await this.cacheService.delPattern(`appointments:salon:${existingAppointment.userId}:*`);
      await this.cacheService.delPattern(`appointments:date-range:${existingAppointment.userId}:*`);

      return {
        error: false,
        message: 'Rendez-vous confirmé.',
        appointment: appointment,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! ------------------------------------------------------------------------------

  //! ANNULER UN RDV

  //! ------------------------------------------------------------------------------
  async cancelAppointment(id: string, message: string) {
    try {
      const existingAppointment = await this.prisma.appointment.findUnique({
        where: { id },
        include: {
          client: true,
          tatoueur: true,
        },
      });

  if (!existingAppointment) {
    return {
      error: true,
      message: 'Rendez-vous introuvable.',
    };
  }

  const appointment = await this.prisma.appointment.update({
    where: {
      id,
    },
    data: {
      status: 'CANCELED',
    },
    include: {
      client: true,
      tatoueur: true,
    },
  });

  // Gérer la conversation associée au RDV annulé
  try {
    const conversation = await this.prisma.conversation.findFirst({
      where: { appointmentId: id },
      include: {
        messages: {
          select: { id: true },
        },
      },
    });

    if (conversation) {
      const messageCount = conversation.messages.length;

      if (messageCount < 5) {
        // Supprimer la conversation si elle a moins de 5 messages
        await this.prisma.conversation.delete({
          where: { id: conversation.id },
        });
      } else {
        // Archiver la conversation et ajouter un message système
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { status: 'ARCHIVED' },
        });

        // Ajouter un message système
        await this.prisma.message.create({
          data: {
            conversationId: conversation.id,
            senderId: existingAppointment.userId,
            content: 'Ce rendez-vous a été annulé.',
            type: 'SYSTEM',
          },
        });
      }
    }
  } catch (conversationError) {
    console.error('⚠️ Erreur lors de la gestion de la conversation:', conversationError);
    // Ne pas bloquer l'annulation du RDV si la conversation échoue
  }

  // Envoyer un email d'annulation au client (si le client existe)
  if (appointment.client) {
    // Récupérer les informations du salon
    const salon = await this.prisma.user.findUnique({
      where: { id: existingAppointment.userId },
      select: { salonName: true, email: true }
    });

    await this.mailService.sendAppointmentCancellation(
      appointment.client.email,
      {
        recipientName: `${appointment.client.firstName} ${appointment.client.lastName}`,
        appointmentDetails: {
          date: appointment.start.toLocaleDateString('fr-FR', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          }),
          time: `${appointment.start.toLocaleTimeString('fr-FR', { 
            hour: '2-digit', 
            minute: '2-digit' 
          })} - ${appointment.end.toLocaleTimeString('fr-FR', { 
            hour: '2-digit', 
            minute: '2-digit' 
          })}`,
          service: appointment.prestation,
          tatoueur: appointment.tatoueur?.name || 'Non assigné',
          title: appointment.title,
          visio: appointment.visio || false,
          visioRoom: appointment.visio ? `${process.env.FRONTEND_URL || '#'}/meeting/${appointment.id}` : appointment.visioRoom || undefined
        },
        customMessage: message || undefined
      },
      salon?.salonName || undefined,
      salon?.email || undefined
    );
  }

      // Invalider le cache après annulation
      await this.cacheService.del(`appointment:${id}`);
      await this.cacheService.delPattern(`appointments:salon:${existingAppointment.userId}:*`);
      await this.cacheService.delPattern(`appointments:date-range:${existingAppointment.userId}:*`);

      // Invalider le cache du dashboard (annulation change les stats globales)
      await this.invalidateDashboardCache(existingAppointment.userId, { 
        start: existingAppointment.start, 
        isPayed: existingAppointment.isPayed 
      });

      return {
        error: false,
        message: 'Rendez-vous annulé.',
        appointment: appointment,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! ------------------------------------------------------------------------------

//! ANNULER UN RDV PAR LE CLIENT

//! ------------------------------------------------------------------------------
async cancelAppointmentByClient(appointmentId: string, clientUserId: string, reason?: string) {
  try {
    // Récupérer le rendez-vous avec toutes les informations nécessaires
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        client: true,
        tatoueur: {
          select: {
            name: true
          }
        },
        user: {
          select: {
            salonName: true,
            email: true
          }
        }
      }
    });

    if (!appointment) {
      return {
        error: true,
        message: 'Rendez-vous introuvable.'
      };
    }

    // Vérifier que le client connecté est bien celui du RDV
    if (appointment.clientUserId !== clientUserId) {
      return {
        error: true,
        message: 'Vous n\'êtes pas autorisé à annuler ce rendez-vous.'
      };
    }

    // Vérifier que le RDV n'est pas déjà annulé ou terminé
    if (appointment.status === 'CANCELED') {
      return {
        error: true,
        message: 'Ce rendez-vous est déjà annulé.'
      };
    }

    if (appointment.status === 'COMPLETED') {
      return {
        error: true,
        message: 'Impossible d\'annuler un rendez-vous terminé.'
      };
    }

    // Mettre à jour le statut du rendez-vous
    const updatedAppointment = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: 'CANCELED'
      }
    });

    // Gérer la conversation associée au RDV annulé
    try {
      const conversation = await this.prisma.conversation.findFirst({
        where: { appointmentId: appointmentId },
        include: {
          messages: {
            select: { id: true },
          },
        },
      });

      if (conversation) {
        const messageCount = conversation.messages.length;

        if (messageCount < 5) {
          // Supprimer la conversation si elle a moins de 5 messages
          await this.prisma.conversation.delete({
            where: { id: conversation.id },
          });
        } else {
          // Archiver la conversation et ajouter un message système
          await this.prisma.conversation.update({
            where: { id: conversation.id },
            data: { status: 'ARCHIVED' },
          });

          // Ajouter un message système
          await this.prisma.message.create({
            data: {
              conversationId: conversation.id,
              senderId: appointment.userId,
              content: 'Ce rendez-vous a été annulé.',
              type: 'SYSTEM',
            },
          });
        }
      }
    } catch (conversationError) {
      console.error('⚠️ Erreur lors de la gestion de la conversation:', conversationError);
      // Ne pas bloquer l'annulation du RDV si la conversation échoue
    }

    // Envoyer un email au salon pour l'informer de l'annulation
    try {
      const clientName = `${appointment.client?.firstName || ''} ${appointment.client?.lastName || ''}`.trim();
      
      // Formater la date et l'heure
      const appointmentDate = new Date(appointment.start).toLocaleDateString('fr-FR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      
      const appointmentTime = `${new Date(appointment.start).toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit'
      })} - ${new Date(appointment.end).toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit'
      })}`;

      // Email de notification au salon avec template
      await this.mailService.sendClientCancellationNotification(
        appointment.user.email,
        {
          salonName: appointment.user.salonName || undefined,
          clientCancellationDetails: {
            clientName: clientName || 'Client',
            clientEmail: appointment.client?.email,
            clientPhone: appointment.client?.phone,
            appointmentDate,
            appointmentTime,
            prestation: appointment.prestation,
            tatoueurName: appointment.tatoueur?.name,
            cancellationReason: reason
          }
        },
        appointment.user.salonName || undefined,
        appointment.userId
      );

      // Envoyer un email de confirmation au client
      if (appointment.client?.email) {
        await this.mailService.sendClientCancellationConfirmation(
          appointment.client.email,
          {
            recipientName: clientName,
            salonName: appointment.user.salonName || undefined,
            clientCancellationDetails: {
              clientName,
              appointmentDate,
              appointmentTime,
              prestation: appointment.prestation,
              tatoueurName: appointment.tatoueur?.name
            }
          },
          appointment.user.salonName || undefined,
          appointment.user.email,
          appointment.userId
        );
      }
    } catch (emailError) {
      console.error('Erreur lors de l\'envoi des emails d\'annulation:', emailError);
      // Continue même si l'email échoue
    }

    // Invalider les caches
    await this.cacheService.del(`appointment:${appointmentId}`);
    await this.cacheService.delPattern(`appointments:salon:${appointment.userId}:*`);
    await this.cacheService.delPattern(`appointments:date-range:${appointment.userId}:*`);
    await this.cacheService.delPattern(`client:appointments:${clientUserId}:*`);

    // Invalider le cache du dashboard
    await this.invalidateDashboardCache(appointment.userId, { 
      start: appointment.start, 
      isPayed: appointment.isPayed 
    });

    return {
      error: false,
      message: 'Rendez-vous annulé avec succès.',
      appointment: updatedAppointment
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return {
      error: true,
      message: errorMessage,
    };
  }
}

  //! ------------------------------------------------------------------------------

  //! CHANGER LE STATUT D'UN RDV CONFIRME PASSE À "COMPLETED" OU "NO_SHOW"

  //! ------------------------------------------------------------------------------
  async changeAppointmentStatus(id: string, statusData: 'COMPLETED' | 'NO_SHOW' | { status: 'COMPLETED' | 'NO_SHOW' }) {
    // Extraire le statut si c'est un objet, sinon utiliser directement la valeur
    const status = typeof statusData === 'object' && statusData !== null && 'status' in statusData 
      ? statusData.status 
      : statusData;
    
    // Validation du statut
    if (!['COMPLETED', 'NO_SHOW'].includes(status)) {
      return {
        error: true,
        message: `Statut invalide: ${status}. Les statuts autorisés sont: COMPLETED, NO_SHOW`,
      };
    }

    try {
      const appointment = await this.prisma.appointment.update({
        where: { id },
        data: { status },
        include: {
          tatoueur: true,
          client: true,
          performerUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
          tattooDetail: true,
        },
      });

      // Créer un historique de tatouage si le RDV est COMPLETED et de type TATTOO/PIERCING
      if (status === 'COMPLETED' && 
          (appointment.prestation === 'TATTOO' || appointment.prestation === 'PIERCING') &&
          appointment.client && appointment.tattooDetail) {
        
        try {
          await this.prisma.tattooHistory.create({
            data: {
              clientId: appointment.clientId!,
              tatoueurId: appointment.tatoueurId,
              date: appointment.start, // Date du RDV
              description: appointment.tattooDetail.description || appointment.title,
              zone: appointment.tattooDetail.zone,
              size: appointment.tattooDetail.size,
              price: appointment.tattooDetail.price || 0,
              // Les autres champs sont optionnels et peuvent être renseignés plus tard
              inkUsed: null,
              healingTime: null,
              careProducts: null,
              photo: null,
            },
          });
          
        } catch (historyError) {
          console.error('⚠️ Erreur lors de la création de l\'historique:', historyError);
          // On ne fait pas échouer la mise à jour du statut si l'historique échoue
        }

        // Système de suivi automatique selon le type de prestation
        // Les délais sont calculés à partir du moment où le RDV est marqué COMPLETED
        try {
          const completedTime = new Date(); // Moment actuel = quand le RDV est marqué terminé
          
          // 1. Programmer le suivi de cicatrisation pour TATTOO et PIERCING
          await this.followupSchedulerService.scheduleFollowupFromCompletion(appointment.id, completedTime);
          
          // 2. Programmer le rappel retouches uniquement pour les TATTOO
          if (appointment.prestation === 'TATTOO') {
            await Promise.resolve(
              this.followupSchedulerService.scheduleRetouchesReminderFromCompletion(
                appointment.id,
                completedTime,
              ),
            );
          }
        } catch (followupError) {
          console.error('⚠️ Erreur lors de la programmation des suivis:', followupError);
          // On ne fait pas échouer la mise à jour du statut si le suivi échoue
        }
      }

      // Invalider le cache après changement de statut
      await this.cacheService.del(`appointment:${id}`);
      await this.cacheService.delPattern(`appointments:salon:${appointment.userId}:*`);
      await this.cacheService.delPattern(`appointments:date-range:${appointment.userId}:*`);

      return {
        error: false,
        message: `Statut du rendez-vous mis à jour à ${status}.`,
        appointment: appointment,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! ------------------------------------------------------------------------------

  //! ENVOYER UN MAIL PERSONNALISÉ A UN CLIENT 

  //! ------------------------------------------------------------------------------
  async sendCustomEmail(appointmentId: string, subject: string, body: string) {
    try {
      // Récupérer le rendez-vous avec les informations du client et du salon
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          client: true,
          user: {
            select: {
              salonName: true,
              email: true,
            },
          },
        },
      });

      if (!appointment) {
        return {
          error: true,
          message: 'Rendez-vous non trouvé',
        };
      }

      if (!appointment.client) {
        return {
          error: true,
          message: 'Client non trouvé pour ce rendez-vous',
        };
      }

      // Envoyer l'email personnalisé avec le template et le nom du salon
      await this.mailService.sendCustomEmail(
        appointment.client.email,
        subject,
        {
          recipientName: `${appointment.client.firstName} ${appointment.client.lastName}`,
          customMessage: body,
        },
        appointment.user?.salonName || undefined,
        appointment.user?.email || undefined
      );

      return {
        error: false,
        message: 'Email personnalisé envoyé avec succès.',
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! ------------------------------------------------------------------------------

  //! VOIR LES RDV PAR TATOUEUR

  //! ------------------------------------------------------------------------------
  async getTatoueurAppointments(tatoueurId: string) {
    try {
      const resolvedTatoueurId = this.normalizeTatoueurSelectionId(tatoueurId);
      const appointments = await this.prisma.appointment.findMany({
        where: {
          OR: [
            { tatoueurId: resolvedTatoueurId },
            { performerUserId: resolvedTatoueurId },
            { userId: resolvedTatoueurId },
          ],
        },
        include: {
          tatoueur: true,
          performerUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              salonName: true,
            },
          },
        },
      });
      return this.normalizeAppointmentsTatoueur(appointments);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! ------------------------------------------------------------------------------

  //! RENDEZ-VOUS PAYES : Passer isPayed à true

  //! ------------------------------------------------------------------------------
  async markAppointmentAsPaid(id: string, isPayed: boolean) {
    try {

      const appointment = await this.prisma.appointment.update({
        where: { id },
        data: { isPayed: isPayed },
        include: {
          tatoueur: true,
          client: true,
          tattooDetail: true,
        },
      });

      return {
        error: false,
        message: `Rendez-vous marqué comme ${isPayed ? 'payé' : 'non payé'}.`,
        appointment: appointment,
      };
    } catch (error: unknown) {
      console.error("❌ Erreur lors de la mise à jour du statut de paiement :", error);
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  // ! -------------------------------------------------------------------------

  //! DASHBOARD - STATISTIQUES

  // ! --------------------------------------------------------------------------

  //! ------------------------------------------------------------------------------

  //! VOIR LES RDV D'UNE DATE SPÉCIFIQUE POUR DASHBOARD

  //! ------------------------------------------------------------------------------
  /**
   * Récupère les rendez-vous d'une date spécifique pour le dashboard avec cache Redis
   * Si aucune date n'est fournie, utilise la date du jour
   * @param userId - ID du salon/utilisateur
   * @param targetDate - Date cible au format string (ex: "2024-08-07") - optionnel
   * @returns Liste des rendez-vous de la date spécifiée
   */
  async getTodaysAppointments(userId: string, targetDate?: string) {
    try {
      // ==================== ÉTAPE 1: DÉTERMINER LA DATE CIBLE ====================
      let selectedDate: Date;
      
      if (targetDate) {
        // Si une date est fournie, l'utiliser
        selectedDate = new Date(targetDate);
        
        // Vérifier si la date est valide
        if (isNaN(selectedDate.getTime())) {
          return {
            error: true,
            message: `Date invalide: ${targetDate}. Format attendu: YYYY-MM-DD`,
          };
        }
      } else {
        // Sinon, utiliser la date du jour
        selectedDate = new Date();
      }

      // Début de la journée (00:00:00)
      const startOfDay = new Date(selectedDate);
      startOfDay.setHours(0, 0, 0, 0);
      const dateKey = startOfDay.toISOString().split('T')[0]; // Format YYYY-MM-DD

      // ==================== CACHE: VÉRIFIER LE CACHE REDIS ====================
      const cacheKey = `dashboard:today-appointments:${userId}:${dateKey}`;
      
      try {
        const cachedData = await this.cacheService.get(cacheKey);
        if (cachedData) {
          if (
            typeof cachedData === 'object'
            && cachedData
            && 'appointments' in (cachedData as any)
            && Array.isArray((cachedData as any).appointments)
          ) {
            (cachedData as any).appointments = this.normalizeAppointmentsTatoueur((cachedData as any).appointments as Record<string, any>[]);
          }
          return cachedData;
        }
      } catch (cacheError) {
        console.warn('Erreur cache Redis pour getTodaysAppointments:', cacheError);
      }

      // ==================== ÉTAPE 2: DÉFINIR LES BORNES DE LA JOURNÉE ====================
      // Fin de la journée (début du jour suivant)
      const endOfDay = new Date(startOfDay);
      endOfDay.setDate(startOfDay.getDate() + 1);
      const scopedWhere = await this.buildScopedAppointmentWhere(userId, {
        status: {
          not: 'CANCELED',
        },
        start: {
          gte: startOfDay,
          lt: endOfDay,
        },
      });

      // ==================== ÉTAPE 3: RÉCUPÉRER LES RDV DE LA JOURNÉE ====================
      const appointments = await this.prisma.appointment.findMany({
        where: scopedWhere,
        include: {
          tatoueur: true,
           performerUser: {
             select: {
               id: true,
               firstName: true,
               lastName: true,
               salonName: true,
             },
           },
           tattooDetail: true,
          conversation: {
            select: {
              id: true,
            },
          },
          client: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
          moodboard: {
            select: { id: true, name: true, description: true },
          },
        },
        orderBy: {
          start: 'asc', // Trier par heure croissante
        },
      });

      // ==================== ÉTAPE 4: FORMATER LA DATE POUR LE RETOUR ====================
      const formattedDate = startOfDay.toLocaleDateString('fr-FR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      
      // ==================== ÉTAPE 5: RETOUR DES RÉSULTATS ====================
      const result = {
        error: false,
        appointments: this.normalizeAppointmentsTatoueur(appointments),
        selectedDate: dateKey,
        formattedDate,
        totalAppointments: appointments.length,
        message: `${appointments.length} rendez-vous trouvé(s) pour le ${formattedDate}`,
      };

      // ==================== CACHE: SAUVEGARDER EN CACHE ====================
      try {
        // TTL différencié: 
        // - Jour actuel: 15 minutes (changements fréquents)
        // - Jours passés: 4 heures (données historiques plus stables)
        // - Jours futurs: 30 minutes (planification qui peut changer)
        const now = new Date();
        const isToday = dateKey === now.toISOString().split('T')[0];
        const isPast = startOfDay < now;
        
        let ttl: number;
        if (isToday) {
          ttl = 15 * 60; // 15 minutes pour le jour actuel
        } else if (isPast) {
          ttl = 4 * 60 * 60; // 4 heures pour les jours passés
        } else {
          ttl = 30 * 60; // 30 minutes pour les jours futurs
        }
        
        await this.cacheService.set(cacheKey, result, ttl);
      } catch (cacheError) {
        console.warn('Erreur sauvegarde cache Redis pour getTodaysAppointments:', cacheError);
      }

      return result;
      
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }


  //! ------------------------------------------------------------------------------

  //! TAUX DE REMPLISSAGE DES CRENAUX PAR SEMAINE

  //! ------------------------------------------------------------------------------
  /**
   * Calcule le taux de remplissage des créneaux pour une période donnée avec cache Redis
   * @param userId - ID du salon/utilisateur
   * @param startDate - Date de début au format string (ex: "2024-08-01")
   * @param endDate - Date de fin au format string (ex: "2024-08-07")
   * @returns Objet contenant le taux de remplissage et les détails
   */
  async getWeeklyFillRate(userId: string, startDate: string, endDate: string) {
    try {
      // ==================== ÉTAPE 1: VALIDATION DES DATES ====================
      // Convertir les chaînes de caractères en objets Date JavaScript
      const start = new Date(startDate);
      const end = new Date(endDate);

      // Vérifier si la date de début est valide
      // isNaN(date.getTime()) retourne true si la date est invalide
      if (isNaN(start.getTime())) {
        return {
          error: true,
          message: `Date de début invalide: ${startDate}. Format attendu: YYYY-MM-DD ou YYYY-MM-DDTHH:mm:ss`,
        };
      }

      // Vérifier si la date de fin est valide
      if (isNaN(end.getTime())) {
        return {
          error: true,
          message: `Date de fin invalide: ${endDate}. Format attendu: YYYY-MM-DD ou YYYY-MM-DDTHH:mm:ss`,
        };
      }

      // Vérifier que la logique des dates est correcte (début < fin)
      if (start >= end) {
        return {
          error: true,
          message: 'La date de début doit être antérieure à la date de fin.',
        };
      }

      // ==================== CACHE: VÉRIFIER LE CACHE REDIS ====================
      const cacheKey = `dashboard:fill-rate:${userId}:${startDate}:${endDate}`;
      
      try {
        const cachedData = await this.cacheService.get(cacheKey);
        if (cachedData) {
          return cachedData;
        }
      } catch (cacheError) {
        console.warn('Erreur cache Redis pour getWeeklyFillRate:', cacheError);
      }

      // ==================== ÉTAPE 2: RÉCUPÉRATION DES RENDEZ-VOUS ====================
      // Chercher tous les rendez-vous du salon dans la période donnée
      const visibilityWhere = await this.buildAppointmentVisibilityWhere(userId);
      const appointments = await this.prisma.appointment.findMany({
        where: {
          ...visibilityWhere,
          start: { // Filtrer par date de début du rendez-vous
            gte: start, // gte = "greater than or equal" (>= date de début)
            lte: end,   // lte = "less than or equal" (<= date de fin)
          },
        },
      });

      // ==================== ÉTAPE 3: CALCUL DES STATISTIQUES ====================
      // Calculer le nombre total de créneaux disponibles dans la période
      const totalSlots = this.calculateTotalSlots(start, end);
      
      // Compter le nombre de créneaux occupés (= nombre de rendez-vous)
      const filledSlots = appointments.length;

      // ==================== ÉTAPE 4: CALCUL DU TAUX DE REMPLISSAGE ====================
      // Formule: (créneaux occupés / créneaux totaux) * 100
      // Math.round(x * 100) / 100 = arrondir à 2 décimales
      // Exemple: 23 RDV sur 56 créneaux = (23/56)*100 = 41.07%
      const fillRate = totalSlots > 0 
        ? Math.round((filledSlots / totalSlots) * 100 * 100) / 100 
        : 0; // Éviter la division par zéro

      // ==================== ÉTAPE 5: RETOUR DES RÉSULTATS ====================
      const result = {
        error: false,
        userId,                 // ID du salon
        startDate,              // Date de début (format original)
        endDate,                // Date de fin (format original)
        totalSlots,             // Nombre total de créneaux disponibles
        filledSlots,            // Nombre de créneaux occupés
        fillRate,               // Taux de remplissage en pourcentage
      };

      // ==================== CACHE: SAUVEGARDER EN CACHE ====================
      try {
        // TTL différencié selon la période:
        // - Périodes passées: 6 heures (données historiques stables)
        // - Période actuelle: 1 heure (peut changer avec nouveaux RDV)
        // - Périodes futures: 2 heures (planification qui évolue)
        const now = new Date();
        const isPastPeriod = end < now;
        const isCurrentPeriod = start <= now && end >= now;
        
        let ttl: number;
        if (isPastPeriod) {
          ttl = 6 * 60 * 60; // 6 heures pour les périodes passées
        } else if (isCurrentPeriod) {
          ttl = 60 * 60; // 1 heure pour la période actuelle
        } else {
          ttl = 2 * 60 * 60; // 2 heures pour les périodes futures
        }
        
        await this.cacheService.set(cacheKey, result, ttl);
      } catch (cacheError) {
        console.warn('Erreur sauvegarde cache Redis pour getWeeklyFillRate:', cacheError);
      }

      return result;

    } catch (error: unknown) {
      // ==================== GESTION D'ERREURS ====================
      // Si une erreur inattendue survient (problème DB, etc.)
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  /**
   * Calcule le nombre total de créneaux disponibles entre deux dates
   * @param start - Date de début
   * @param end - Date de fin
   * @returns Nombre total de créneaux
   */
  private calculateTotalSlots(start: Date, end: Date): number {
    // ==================== CALCUL DU NOMBRE DE JOURS ====================
    // Différence en millisecondes entre les deux dates
    const timeDifference = end.getTime() - start.getTime();
    
    // Convertir en jours: 1000ms * 60s * 60min * 24h = millisecondes par jour
    // Math.ceil() arrondit vers le haut pour inclure les jours partiels
    const totalDays = Math.ceil(timeDifference / (1000 * 60 * 60 * 24));
    
    // ==================== CALCUL DES CRÉNEAUX ====================
    // Supposons 8 créneaux de 1 heure par jour (10h-18h par exemple)
    // Vous pouvez ajuster ce nombre selon vos horaires d'ouverture
    const slotsPerDay = 8;
    
    // Calcul final: jours × créneaux par jour
    // Math.max(0, ...) assure qu'on ne retourne jamais un nombre négatif
    return Math.max(0, totalDays * slotsPerDay);
  }

  //! ------------------------------------------------------------------------------

  //! TAUX D'ANNULATION GLOBAL DES RDV

  //! ------------------------------------------------------------------------------
  /**
   * Calcule le taux d'annulation global de tous les rendez-vous du salon avec cache Redis
   * @param userId - ID du salon/utilisateur
   * @returns Objet contenant le taux d'annulation global et les détails
   */
  async getGlobalCancellationRate(userId: string) {
    try {
      // ==================== CACHE: VÉRIFIER LE CACHE REDIS ====================
      const cacheKey = `dashboard:global-cancellation:${userId}`;
      
      try {
        const cachedData = await this.cacheService.get(cacheKey);
        if (cachedData) {
          return cachedData;
        }
      } catch (cacheError) {
        console.warn('Erreur cache Redis pour getGlobalCancellationRate:', cacheError);
      }

      // ==================== ÉTAPE 1: RÉCUPÉRATION DES STATISTIQUES GLOBALES ====================
      // Compter le nombre total de rendez-vous du salon (depuis le début)
      const visibilityWhere = await this.buildAppointmentVisibilityWhere(userId);
      const totalAppointments = await this.prisma.appointment.count({
        where: {
          ...visibilityWhere,
        },
      });

      // Compter le nombre de rendez-vous annulés du salon (depuis le début)
      const cancelledAppointments = await this.prisma.appointment.count({
        where: {
          ...visibilityWhere,
          status: 'CANCELED', // Filtrer uniquement les RDV annulés
        },
      });

      // Compter le nombre de rendez-vous confirmés du salon
      const confirmedAppointments = await this.prisma.appointment.count({
        where: {
          ...visibilityWhere,
          status: 'CONFIRMED', // Filtrer uniquement les RDV confirmés
        },
      });

      // Compter le nombre de rendez-vous en attente (status par défaut = PENDING)
      const pendingAppointments = await this.prisma.appointment.count({
        where: {
          ...visibilityWhere,
          status: 'PENDING', // Uniquement les RDV en attente
        },
      });

      // ==================== ÉTAPE 2: CALCULS ADDITIONNELS ====================
      // Calculer les autres métriques utiles
      const completedAppointments = totalAppointments - cancelledAppointments - pendingAppointments;

      // ==================== ÉTAPE 3: CALCUL DU TAUX D'ANNULATION GLOBAL ====================
      // Formule: (RDV annulés / Total RDV) * 100
      // Exemple: 45 annulés sur 200 total = (45/200)*100 = 22.5%
      const cancellationRate = totalAppointments > 0 
        ? Math.round((cancelledAppointments / totalAppointments) * 100 * 100) /  100 
        : 0; // Éviter la division par zéro

      // Calculer le taux de confirmation
      const confirmationRate = totalAppointments > 0 
        ? Math.round((confirmedAppointments / totalAppointments) * 100 * 100) / 100 
        : 0;

      // ==================== ÉTAPE 4: RETOUR DES RÉSULTATS GLOBAUX ====================
      const result = {
        error: false,                    // Pas d'erreur
        userId,                          // ID du salon
        totalAppointments,               // Nombre total de RDV depuis le début
        cancelledAppointments,           // Nombre de RDV annulés
        confirmedAppointments,           // Nombre de RDV confirmés
        pendingAppointments,             // Nombre de RDV en attente
        completedAppointments,           // Nombre de RDV réalisés/terminés
        cancellationRate,                // Taux d'annulation global en %
        confirmationRate,                // Taux de confirmation en %
        message: `Statistiques globales du salon calculées avec succès`,
      };

      // ==================== CACHE: SAUVEGARDER EN CACHE ====================
      try {
        // TTL de 2 heures pour les statistiques globales
        // Ces données changent moins fréquemment et sont coûteuses à calculer
        const ttl = 2 * 60 * 60; // 2 heures
        
        await this.cacheService.set(cacheKey, result, ttl);
      } catch (cacheError) {
        console.warn('Erreur sauvegarde cache Redis pour getGlobalCancellationRate:', cacheError);
      }

      return result;

    } catch (error: unknown) {
      // ==================== GESTION D'ERREURS ====================
      // Si une erreur inattendue survient (problème DB, etc.)
     
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }
  //! ------------------------------------------------------------------------------

  //! SOMME DES PRIX DES RDV PAYÉS PAR MOIS

  //! ------------------------------------------------------------------------------
  /**
   * Calcule la somme des prix des rendez-vous payés pour un mois donné avec cache Redis
   * Le prix d'un tatouage se trouve dans la table TattooDetails
   * @request userId - ID du salon/utilisateur
   * @param month - Mois (1-12)
   * @param year - Année (ex: 2024)
   * @returns Objet contenant le total des prix des RDV payés
   */
  async getTotalPaidAppointmentsByMonth(userId: string, month: number, year: number) {
    try {
      // ==================== ÉTAPE 1: VALIDATION DES PARAMÈTRES ====================
      // Vérifier que le mois est valide (1-12)
      if (month < 1 || month > 12) {
        return {
          error: true,
          message: 'Mois invalide. Veuillez fournir un mois entre 1 et 12.',
        };
      }

      // ==================== CACHE: VÉRIFIER LE CACHE REDIS ====================
      const cacheKey = `dashboard:monthly-paid:${userId}:${year}-${month.toString().padStart(2, '0')}`;
      
      try {
        const cachedData = await this.cacheService.get(cacheKey);
        if (cachedData) {
          return cachedData;
        }
      } catch (cacheError) {
        console.warn('Erreur cache Redis pour getTotalPaidAppointmentsByMonth:', cacheError);
      }

      // ==================== ÉTAPE 2: CALCUL DES DATES DU MOIS ====================
      // Créer les dates de début et de fin du mois
      // month-1 car les mois JavaScript commencent à 0
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 1); // Premier jour du mois suivant
      endDate.setHours(0, 0, 0, 0); // Assurer que l'heure est à minuit

      // ==================== ÉTAPE 3: RÉCUPÉRATION DES RDV DU MOIS ====================
      // D'abord, récupérer TOUS les RDV du mois pour debug
      const visibilityWhere = await this.buildAppointmentVisibilityWhere(userId);
      const allAppointments = await this.prisma.appointment.findMany({
        where: {
          ...visibilityWhere,
          start: {
            gte: startDate, // >= date de début du mois
            lt: endDate,    // < date de début du mois suivant
          },
        },
        include: {
          tattooDetail: {
            select: {
              price: true,
              estimatedPrice: true,
            },
          },
        },
      });

      // ==================== ÉTAPE 4: FILTRAGE DES RDV PAYÉS ====================
      // Récupérer uniquement les RDV avec Appointment.isPayed = true
      const paidAppointments = await this.prisma.appointment.findMany({
        where: {
          ...visibilityWhere,
          isPayed: true, // Seul critère : RDV marqué comme payé dans Appointment
          start: {
            gte: startDate,
            lt: endDate,
          },
        },
        include: {
          tattooDetail: {
            select: {
              price: true,
              estimatedPrice: true,
            },
          },
        },
      });

      // ==================== ÉTAPE 5: CALCUL DU TOTAL ====================
      // Calculer la somme des prix des rendez-vous payés
      let totalPaid = 0;
      let rdvWithPrice = 0;
      let rdvWithoutPrice = 0;

      // Définir le type pour les appointements avec tattooDetail
      type AppointmentWithTattooDetail = {
        id: string;
        tattooDetail?: {
          price?: number | null;
          estimatedPrice?: number | null;
        } | null;
      };

      (paidAppointments as AppointmentWithTattooDetail[]).forEach(appointment => {
        const price = appointment.tattooDetail?.price;
        if (price && typeof price === 'number') {
          totalPaid += price;
          rdvWithPrice++;
        } else {
          rdvWithoutPrice++;
        }
      });

      // ==================== ÉTAPE 6: INFORMATIONS DE DEBUG ====================
      // Compter les RDV par statut pour diagnostic
      const statusCounts = {
        total: allAppointments.length,
        paid: paidAppointments.length,
        unpaid: allAppointments.filter(apt => !apt.isPayed).length,
        withTattooDetail: allAppointments.filter(apt => apt.tattooDetail).length,
        withPrice: allAppointments.filter(apt => apt.tattooDetail?.price && apt.tattooDetail.price > 0).length,
      };

      // ==================== ÉTAPE 7: RETOUR DES RÉSULTATS ====================
      const result = {
        error: false,
        userId,
        month,
        year,
        totalPaid,                    // Somme totale des prix
        paidAppointmentsCount: paidAppointments.length,  // Nombre de RDV payés
        appointmentsWithPrice: rdvWithPrice,             // RDV payés avec prix
        appointmentsWithoutPrice: rdvWithoutPrice,       // RDV payés sans prix
        debugInfo: statusCounts,      // Infos de debug
        message: `Total des rendez-vous payés pour ${month}/${year}: ${totalPaid}€`,
      };

      // ==================== CACHE: SAUVEGARDER EN CACHE ====================
      try {
        // TTL différencié selon le mois:
        // - Mois passés: 24 heures (données historiques très stables)
        // - Mois actuel: 1 heure (peut changer avec nouveaux paiements)
        // - Mois futurs: 4 heures (paiements anticipés possibles)
        const now = new Date();
        const currentMonth = now.getMonth() + 1;
        const currentYear = now.getFullYear();
        
        let ttl: number;
        if (year < currentYear || (year === currentYear && month < currentMonth)) {
          ttl = 24 * 60 * 60; // 24 heures pour les mois passés
        } else if (year === currentYear && month === currentMonth) {
          ttl = 60 * 60; // 1 heure pour le mois actuel
        } else {
          ttl = 4 * 60 * 60; // 4 heures pour les mois futurs
        }
        
        await this.cacheService.set(cacheKey, result, ttl);
      } catch (cacheError) {
        console.warn('Erreur sauvegarde cache Redis pour getTotalPaidAppointmentsByMonth:', cacheError);
      }

      return result;

    } catch (error: unknown) {
      // ==================== GESTION D'ERREURS ====================
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      console.error('❌ Erreur dans getTotalPaidAppointmentsByMonth:', errorMessage);
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! ------------------------------------------------------------------------------

  //! RDV EN ATTENTE DE CONFIRMATION

  //! ------------------------------------------------------------------------------
  async getPendingAppointments(userId: string) {
    try {
      const visibilityWhere = await this.buildAppointmentVisibilityWhere(userId);
      const pendingAppointments = await this.prisma.appointment.findMany({
        where: {
          ...visibilityWhere,
          status: { in: ['PENDING', 'RESCHEDULING'] }, // Filtrer les RDV en attente et en reprogrammation
        },
        include: {
          tatoueur: {
            select: {
              id: true,
              name: true,
            },
          },
          performerUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              salonName: true,
            },
          },
          tattooDetail : true,
          conversation: {
            select: {
              id: true,
            },
          },
          client: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
        },
        orderBy: {
          start: 'asc', // Trier par date croissante
        },
      });
      return {
        error: false,
        appointments: this.normalizeAppointmentsTatoueur(pendingAppointments),
        totalAppointments: pendingAppointments.length,
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