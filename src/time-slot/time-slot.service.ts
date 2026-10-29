import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { bookingHoursWindow } from '../../utils/booking-hours';
import { AgendaMode } from '@prisma/client';
import { addMinutes, isBefore } from 'date-fns';
import { PrismaService } from 'src/database/prisma.service';

interface BlockedTimeSlotWhereCondition {
  AND: Array<{
    startDate?: { lt: Date };
    endDate?: { gt: Date };
  }>;
  OR?: Array<{ tatoueurId: string | null }>;
  tatoueurId?: null;
  userId?: string;
}

@Injectable()
export class TimeSlotService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * ! Détermine le mode d'agenda effectif.
   * La règle métier est pilotée par le rôle:
   * - user_salon => PAR_TATOUEUR
   * - user_tatoueur => GLOBAL
   * - fallback => valeur stockée, puis GLOBAL.
   */
  private resolveAgendaMode({
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

  /**
   * ! Lit la configuration d'un salon et renvoie son mode d'agenda final.
   */
  private async getSalonAgendaMode(userId: string): Promise<AgendaMode> {
    const salon = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        saasPlanDetails: {
          select: {
            agendaMode: true,
          },
        },
      },
    });

    return this.resolveAgendaMode({
      role: salon?.role,
      agendaMode: salon?.saasPlanDetails?.agendaMode,
    });
  }

  /**
   * ! Génère des créneaux de 30 minutes pour une date donnée à partir des horaires JSON.
   * Peut filtrer les créneaux déjà indisponibles (RDV existants ou blocages),
   * ou les inclure explicitement via includeUnavailable.
   */
  async generateTimeSlotsForDate(
    date: Date,
    salonHoursJson: string,
    userId?: string,
    tatoueurId?: string,
    includeUnavailable = false,
    forcedAgendaMode?: AgendaMode,
  ): Promise<{ start: Date; end: Date }[]> {
    const window = bookingHoursWindow(date, salonHoursJson);
    if (!window) return [];

    const agendaMode =
      forcedAgendaMode ??
      (userId ? await this.getSalonAgendaMode(userId) : AgendaMode.GLOBAL);

    const slots: { start: Date; end: Date }[] = [];

    const current = new Date(window.start);
    const end = window.end;

    while (isBefore(current, end)) {
      const slotStart = new Date(current);
      const slotEnd = addMinutes(slotStart, 30);

      if (isBefore(slotEnd, end) || slotEnd.getTime() === end.getTime()) {
        const isUnavailable = userId
          ? await this.isTimeSlotUnavailable({
              startDate: slotStart,
              endDate: slotEnd,
              userId,
              agendaMode,
              tatoueurId,
            })
          : false;

        if (includeUnavailable || !isUnavailable) {
          slots.push({ start: slotStart, end: slotEnd });
        }
      }

      current.setTime(slotEnd.getTime());
    }

    return slots;
  }

  /**
   * ! Génère les créneaux d'un tatoueur (interne ou linked user_tatoueur).
   * La source des horaires et le scope des conflits dépendent du mode GLOBAL/PAR_TATOUEUR.
   */
  async generateTatoueurTimeSlots(
    date: Date,
    tatoueurId: string,
    includeUnavailable = false,
  ) {
    // Normaliser l'ID en enlevant le préfixe "linked_" s'il existe
    const normalizedId = tatoueurId.startsWith('linked_')
      ? tatoueurId.slice(7)
      : tatoueurId;

    // D'abord chercher un Tatoueur interne
    const tatoueur = await this.prisma.tatoueur.findUnique({
      where: { id: normalizedId },
      include: { user: { select: { id: true } } },
    });

    // Si pas trouvé, chercher un User avec le rôle user_tatoueur (tatoueur linked)
    if (!tatoueur) {
      const linkedTatoueur = await this.prisma.user.findUnique({
        where: { id: normalizedId },
        select: {
          id: true,
          salonId: true,
          role: true,
          salonHours: true,
        },
      });

      if (
        !linkedTatoueur ||
        linkedTatoueur.role !== 'user_tatoueur' ||
        !linkedTatoueur.salonId
      ) {
        return [];
      }

      // Cote public, les horaires affiches doivent toujours correspondre au tatoueur
      // selectionne. Pour un user_tatoueur lie, on utilise donc ses propres horaires.
      const hoursJson = linkedTatoueur.salonHours ?? '{}';
      // Exception explicite de scope de conflits pour les profils linked:
      // on force PAR_TATOUEUR afin d'eviter qu'un agenda salon GLOBAL n'ouvre
      // des slots deja pris par ce tatoueur sur son agenda personnel.
      const scopedTatoueurId = normalizedId;

      return this.generateTimeSlotsForDate(
        date,
        hoursJson,
        linkedTatoueur.salonId,
        scopedTatoueurId,
        includeUnavailable,
        AgendaMode.PAR_TATOUEUR,
      );
    }

    if (!tatoueur.hours) return [];

    const salonContext = await this.prisma.user.findUnique({
      where: { id: tatoueur.userId },
      select: {
        salonHours: true,
        role: true,
        saasPlanDetails: {
          select: {
            agendaMode: true,
          },
        },
      },
    });

    const agendaMode = salonContext
      ? this.resolveAgendaMode({
          role: salonContext.role,
          agendaMode: salonContext.saasPlanDetails?.agendaMode,
        })
      : AgendaMode.PAR_TATOUEUR;

    // Cote public, un tatoueur interne doit afficher ses propres horaires, meme si
    // le salon travaille en agenda GLOBAL. Le mode d'agenda ne doit piloter que
    // le scope des conflits, pas la source des horaires affiches.
    const hoursJson = tatoueur.hours;

    const scopedTatoueurId =
      agendaMode === AgendaMode.PAR_TATOUEUR ? normalizedId : undefined;

    return this.generateTimeSlotsForDate(
      date,
      hoursJson,
      tatoueur.userId,
      scopedTatoueurId,
      includeUnavailable,
    );
  }

  /**
   *! Détermine l'indisponibilité d'un créneau en combinant:
   * 1) les blocages manuels
   * 2) les rendez-vous déjà planifiés
   */
  private async isTimeSlotUnavailable({
    startDate,
    endDate,
    userId,
    agendaMode,
    tatoueurId,
  }: {
    startDate: Date;
    endDate: Date;
    userId: string;
    agendaMode: AgendaMode;
    tatoueurId?: string;
  }): Promise<boolean> {
    const isBlocked = await this.isTimeSlotBlocked(
      startDate,
      endDate,
      agendaMode === AgendaMode.PAR_TATOUEUR ? tatoueurId : undefined,
      userId,
      agendaMode === AgendaMode.GLOBAL,
    );

    if (isBlocked) {
      return true;
    }

    return this.isTimeSlotOccupied(
      startDate,
      endDate,
      userId,
      agendaMode,
      tatoueurId,
    );
  }

  /**
   *! Vérifie si un RDV existant chevauche le créneau demandé.
   * En mode PAR_TATOUEUR, le contrôle est restreint au tatoueur ciblé.
   */
  private async isTimeSlotOccupied(
    startDate: Date,
    endDate: Date,
    userId: string,
    agendaMode: AgendaMode,
    tatoueurId?: string,
  ): Promise<boolean> {
    try {
      const whereConditions: Record<string, any> = {
        userId,
        status: { in: ['PENDING', 'CONFIRMED'] },
        start: { lt: endDate },
        end: { gt: startDate },
      };

      if (agendaMode === AgendaMode.PAR_TATOUEUR && tatoueurId) {
        // Un rendez-vous peut être rattaché soit à tatoueurId (tatoueur interne),
        // soit à performerUserId (profil user_tatoueur lié).
        whereConditions.OR = [
          { tatoueurId },
          { performerUserId: tatoueurId },
          { tatoueurId: null, performerUserId: null },
        ];
      }

      const appointment = await this.prisma.appointment.findFirst({
        where: whereConditions,
        select: { id: true },
      });

      return !!appointment;
    } catch (error) {
      console.error(
        'Erreur lors de la vérification des créneaux occupés:',
        error,
      );
      throw new ServiceUnavailableException(
        'Les disponibilites sont momentanement indisponibles.',
      );
    }
  }

  /**
   *! Vérifie si un créneau chevauche un blocage manuel.
   * - Avec tatoueurId: accepte les blocages spécifiques + globaux du salon
   * - GLOBAL: tous les blocages du salon rendent le calendrier indisponible.
   */
  private async isTimeSlotBlocked(
    startDate: Date,
    endDate: Date,
    tatoueurId?: string,
    userId?: string,
    allArtists = false,
  ): Promise<boolean> {
    try {
      // Construire les conditions de recherche
      const whereConditions: BlockedTimeSlotWhereCondition = {
        AND: [
          {
            startDate: {
              lt: endDate, // Le blocage commence avant la fin du créneau
            },
          },
          {
            endDate: {
              gt: startDate, // Le blocage se termine après le début du créneau
            },
          },
        ],
      };

      // Si on cherche pour un tatoueur spécifique
      if (tatoueurId) {
        whereConditions.OR = [
          { tatoueurId: tatoueurId }, // Bloqué spécifiquement pour ce tatoueur
          { tatoueurId: null }, // Bloqué pour tous les tatoueurs du salon
        ];

        if (userId) {
          whereConditions.userId = userId; // S'assurer qu'on reste dans le bon salon
        }
      } else if (userId) {
        // GLOBAL uses every block; a generic per-artist view uses salon-wide blocks.
        whereConditions.userId = userId;
        if (!allArtists) whereConditions.tatoueurId = null;
      }

      // Vérifier s'il existe un créneau bloqué qui chevauche avec le créneau demandé
      const blockedSlot = await this.prisma.blockedTimeSlot.findFirst({
        where: whereConditions,
      });

      return !!blockedSlot;
    } catch (error) {
      console.error('Erreur lors de la vérification de blocage:', error);
      throw new ServiceUnavailableException(
        'Les disponibilites sont momentanement indisponibles.',
      );
    }
  }
}
