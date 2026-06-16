import { BadRequestException, Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { TimeSlotService } from './time-slot.service';
import { PrismaService } from 'src/database/prisma.service';

@Controller('timeslots')
export class TimeSlotController {
  constructor(private readonly timeSlotService: TimeSlotService, private readonly prisma: PrismaService) {}

  private parseIncludeUnavailable(value?: string): boolean {
    return value === 'true' || value === '1';
  }

  private parseDateParam(dateStr: string): Date {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!match) {
      throw new BadRequestException('Le format de date doit etre YYYY-MM-DD');
    }

    const [, yearRaw, monthRaw, dayRaw] = match;
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);
    const parsed = new Date(year, month - 1, day);

    if (
      parsed.getFullYear() !== year
      || parsed.getMonth() !== month - 1
      || parsed.getDate() !== day
    ) {
      throw new BadRequestException('Date invalide');
    }

    return parsed;
  }

  //! Récupérer les créneaux horaires d'un salon pour une date donnée ✅
  @Get('/salon/:salonId') // exemple de route : http://localhost:3000/timeslots/timeslots?date=2025-04-23&salonId=cm8uhfodj0000th6wi3m2afnj
  async getSLots(
    @Param('salonId') salonId: string,
    @Query('date') dateStr: string,
    @Query('includeUnavailable') includeUnavailable?: string,
  ) {
    if (!salonId || !dateStr) {
      throw new BadRequestException('Les paramètres date et salonId sont requis');
    }

    const date = this.parseDateParam(dateStr);

    const user = await this.prisma.user.findUnique({
      where: {
        id: salonId,
      },
      select: {
        id: true,
        salonHours: true,
      },
    });

    if (!user) {
      throw new NotFoundException("Salon introuvable");
    }

    const slots = this.timeSlotService.generateTimeSlotsForDate(
      date,
      user.salonHours ?? '{}',
      user.id,
      undefined,
      this.parseIncludeUnavailable(includeUnavailable),
    );

    return slots;
  }

  //! Récupérer les créneaux horaires d'un tatoueur pour une date donnée ✅
  @Get('tatoueur') // exemple de route : http://localhost:3000/timeslots/tatoueur?date=2025-04-23&tatoueurId=cm8uhfodj0000th6wi3m2afnj
  async getTatoueurSlots(
    @Query('tatoueurId') tatoueurId: string,
    @Query('date') date: string,
    @Query('includeUnavailable') includeUnavailable?: string,
  ) {
    if (!tatoueurId || !date) {
      return { error: true, message: 'tatoueurId et date requis' };
    }

    const dateObj = this.parseDateParam(date);
    const slots = await this.timeSlotService.generateTatoueurTimeSlots(
      dateObj,
      tatoueurId,
      this.parseIncludeUnavailable(includeUnavailable),
    );

    return slots;
  }
}
