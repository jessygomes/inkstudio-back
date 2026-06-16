import { Injectable } from '@nestjs/common';
import { AgendaMode, SaasPlan } from '@prisma/client';
import { addMinutes, isBefore } from 'date-fns';
import { PrismaService } from 'src/database/prisma.service';

type SalonHours = {
  [key: string]: {
    start: string,
    end: string,
  } | null,
};

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
   * Seul un salon BUSINESS avec agenda PAR_TATOUEUR garde ce mode,
   * sinon on retombe sur un agenda GLOBAL.
   */
  private resolveAgendaMode({
    plan,
    agendaMode,
  }: {
    plan?: SaasPlan | null;
    agendaMode?: AgendaMode | null;
  }) {
    return plan === SaasPlan.BUSINESS && agendaMode === AgendaMode.PAR_TATOUEUR
      ? AgendaMode.PAR_TATOUEUR
      : AgendaMode.GLOBAL;
  }

  /**
   * ! Lit la configuration d'un salon et renvoie son mode d'agenda final.
   */
  private async getSalonAgendaMode(userId: string): Promise<AgendaMode> {
    const salon = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        saasPlan: true,
        saasPlanDetails: {
          select: {
            currentPlan: true,
            agendaMode: true,
          },
        },
      },
    });

    return this.resolveAgendaMode({
      plan: salon?.saasPlanDetails?.currentPlan ?? salon?.saasPlan,
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
  ): Promise<{ start: Date, end: Date }[]> {
    let salonHours: SalonHours;

    try {
      salonHours = JSON.parse(salonHoursJson) as SalonHours;
    } catch (err) {
      console.error('Erreur de parsing JSON des horaires du salon', err);
      return [];
    }

    const frToEnDayMap: Record<string, string> = {
      lundi: 'monday',
      mardi: 'tuesday',
      mercredi: 'wednesday',
      jeudi: 'thursday',
      vendredi: 'friday',
      samedi: 'saturday',
      dimanche: 'sunday',
    };

    const frDay = date
      .toLocaleDateString('fr-FR', { weekday: 'long' })
      .toLowerCase();
    const dayOfWeek = frToEnDayMap[frDay];

    const hours = salonHours[dayOfWeek];

    if (!hours) return []; // Jour fermé ou non défini

    const agendaMode = userId
      ? await this.getSalonAgendaMode(userId)
      : AgendaMode.GLOBAL;

    const slots: { start: Date, end: Date }[] = [];

    const [startHour, startMinute] = hours.start.split(':').map(Number);
    const [endHour, endMinute] = hours.end.split(':').map(Number);

    const current = new Date(date);
    current.setHours(startHour, startMinute, 0, 0);

    const end = new Date(date);
    end.setHours(endHour, endMinute, 0, 0);

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
  async generateTatoueurTimeSlots(date: Date, tatoueurId: string, includeUnavailable = false) {
    // Normaliser l'ID en enlevant le préfixe "linked_" s'il existe
    const normalizedId = tatoueurId.startsWith('linked_') ? tatoueurId.slice(7) : tatoueurId;

    // D'abord chercher un Tatoueur interne
    const tatoueur = await this.prisma.tatoueur.findUnique({
      where: { id: normalizedId },
      include: { user: { select: { id: true } } }
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

      if (!linkedTatoueur || linkedTatoueur.role !== 'user_tatoueur' || !linkedTatoueur.salonId) {
        return [];
      }

      // Pour un tatoueur linked, utiliser ses horaires et le salon
      const salonContext = await this.prisma.user.findUnique({
        where: { id: linkedTatoueur.salonId },
        select: {
          salonHours: true,
          saasPlan: true,
          saasPlanDetails: {
            select: {
              currentPlan: true,
              agendaMode: true,
            },
          },
        },
      });

      const agendaMode = salonContext
        ? this.resolveAgendaMode({
            plan: salonContext.saasPlanDetails?.currentPlan ?? salonContext.saasPlan,
            agendaMode: salonContext.saasPlanDetails?.agendaMode,
          })
        : AgendaMode.PAR_TATOUEUR;

      // Pour les linked tatoueurs, utiliser les horaires du salon ou les horaires globaux
      const hoursJson = linkedTatoueur.salonHours ?? salonContext?.salonHours ?? '{}';
      const scopedTatoueurId = agendaMode === AgendaMode.PAR_TATOUEUR
        ? normalizedId
        : undefined;

      return this.generateTimeSlotsForDate(
        date,
        hoursJson,
        linkedTatoueur.salonId,
        scopedTatoueurId,
        includeUnavailable,
      );
    }

    if (!tatoueur.hours) return [];

    const salonContext = await this.prisma.user.findUnique({
      where: { id: tatoueur.userId },
      select: {
        salonHours: true,
        saasPlan: true,
        saasPlanDetails: {
          select: {
            currentPlan: true,
            agendaMode: true,
          },
        },
      },
    });

    const agendaMode = salonContext
      ? this.resolveAgendaMode({
          plan: salonContext.saasPlanDetails?.currentPlan ?? salonContext.saasPlan,
          agendaMode: salonContext.saasPlanDetails?.agendaMode,
        })
      : AgendaMode.PAR_TATOUEUR;

    const hoursJson = agendaMode === AgendaMode.GLOBAL
      ? salonContext?.salonHours ?? '{}'
      : tatoueur.hours;

    const scopedTatoueurId = agendaMode === AgendaMode.PAR_TATOUEUR
      ? normalizedId
      : undefined;

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
    );

    if (isBlocked) {
      return true;
    }

    return this.isTimeSlotOccupied(startDate, endDate, userId, agendaMode, tatoueurId);
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
        status: { in: ['PENDING', 'CONFIRMED', 'RESCHEDULING'] },
        start: { lt: endDate },
        end: { gt: startDate },
      };

      if (agendaMode === AgendaMode.PAR_TATOUEUR && tatoueurId) {
        whereConditions.tatoueurId = tatoueurId;
      }

      const appointment = await this.prisma.appointment.findFirst({
        where: whereConditions,
        select: { id: true },
      });

      return !!appointment;
    } catch (error) {
      console.error('Erreur lors de la vérification des créneaux occupés:', error);
      return false;
    }
  }

  /**
   *! Vérifie si un créneau chevauche un blocage manuel.
   * - Avec tatoueurId: accepte les blocages spécifiques + globaux du salon
   * - Sans tatoueurId: ne prend que les blocages globaux du salon
   */
  private async isTimeSlotBlocked(startDate: Date, endDate: Date, tatoueurId?: string, userId?: string): Promise<boolean> {
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
        // Si on cherche pour le salon en général, seuls les blocages globaux comptent
        whereConditions.userId = userId;
        whereConditions.tatoueurId = null;
      }

      // Vérifier s'il existe un créneau bloqué qui chevauche avec le créneau demandé
      const blockedSlot = await this.prisma.blockedTimeSlot.findFirst({
        where: whereConditions,
      });

      return !!blockedSlot;
    } catch (error) {
      console.error('Erreur lors de la vérification de blocage:', error);
      return false; // En cas d'erreur, on considère que ce n'est pas bloqué
    }
  }
}
