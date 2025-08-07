import { Injectable } from '@nestjs/common';
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
  userId?: string;
}

@Injectable()
export class TimeSlotService {
  constructor(private readonly prisma: PrismaService) {}
  
  async generateTimeSlotsForDate(
    date: Date,
    salonHoursJson: string,
    userId?: string
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
        // Vérifier si ce créneau n'est pas bloqué (si userId fourni)
        let isBlocked = false;
        if (userId) {
          isBlocked = await this.isTimeSlotBlocked(slotStart, slotEnd, undefined, userId);
        }

        if (!isBlocked) {
          slots.push({ start: slotStart, end: slotEnd });
        }
      }

      current.setTime(slotEnd.getTime());
    }

    return slots;
  }

  async generateTatoueurTimeSlots(date: Date, tatoueurId: string) {
    const tatoueur = await this.prisma.tatoueur.findUnique({
      where: { id: tatoueurId },
      include: { user: { select: { id: true } } }
    });

    if (!tatoueur || !tatoueur.hours) return [];

    const baseSlots = await this.generateTimeSlotsForDate(date, tatoueur.hours, tatoueur.userId);
    
    // Filtrer les créneaux bloqués pour ce tatoueur spécifiquement
    const availableSlots: { start: Date, end: Date }[] = [];
    
    for (const slot of baseSlots) {
      const isBlocked = await this.isTimeSlotBlocked(slot.start, slot.end, tatoueurId, tatoueur.userId);
      if (!isBlocked) {
        availableSlots.push(slot);
      }
    }

    return availableSlots;
  }

  //! VÉRIFIER SI UN CRÉNEAU EST BLOQUÉ
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
        // Si on cherche pour le salon en général
        whereConditions.userId = userId;
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
