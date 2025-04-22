/* eslint-disable prettier/prettier */
import { Injectable } from '@nestjs/common';
import { addMinutes, isBefore } from 'date-fns';

type SalonHours = {
  [key: string]: {
    start: string,
    end: string,
  } | null,
};

@Injectable()
export class TimeSlotService {
  generateTimeSlotsForDate(
    date: Date,
    salonHoursJson: string,
  ): { start: Date, end: Date }[] {
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
        slots.push({ start: slotStart, end: slotEnd });
      }

      current.setTime(slotEnd.getTime());
    }

    return slots;
  }
}
