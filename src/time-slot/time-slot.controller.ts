import { BadRequestException, Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { TimeSlotService } from './time-slot.service';
import { PrismaService } from 'src/database/prisma.service';

@Controller('timeslots')
export class TimeSlotController {
  constructor(private readonly timeSlotService: TimeSlotService, private readonly prisma: PrismaService) {}

  //! Récupérer les créneaux horaires d'un salon pour une date donnée ✅
  @Get('/salon/:salonId') // exemple de route : http://localhost:3000/timeslots/timeslots?date=2025-04-23&salonId=cm8uhfodj0000th6wi3m2afnj
  async getSLots(@Query('salonId') salonId: string, @Query('date') dateStr: string,) {
    if (!salonId || !dateStr) {
      throw new BadRequestException('Les paramètres date et salonId sont requis');
    }

    const date = new Date(dateStr);

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
      user.salonHours ?? '{}'
    );

    return slots;
  }

  @Get('tatoueur') // exemple de route : http://localhost:3000/timeslots/tatoueur?date=2025-04-23&tatoueurId=cm8uhfodj0000th6wi3m2afnj
  async getTatoueurSlots(
    @Query('tatoueurId') tatoueurId: string,
    @Query('date') date: string
  ) {
    if (!tatoueurId || !date) {
      return { error: true, message: 'tatoueurId et date requis' };
    }

    const dateObj = new Date(date);
    const slots = await this.timeSlotService.generateTatoueurTimeSlots(
      dateObj,
      tatoueurId
    );

    return slots;
  }
}
