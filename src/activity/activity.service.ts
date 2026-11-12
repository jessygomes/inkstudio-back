import { Injectable } from '@nestjs/common';
import { SaasPlan } from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';
import { AppointmentsService } from '../appointments/appointments.service';

export type ActivityItem = { id: string; createdAt: Date };
export type RecentActivity = { appointments: ActivityItem[]; followUps: ActivityItem[]; reviews: ActivityItem[] };

/** Fenêtre maximale : un élément plus ancien n'est plus « nouveau ». */
export const ACTIVITY_MAX_DAYS = 30;
/** Plafond par type, pour qu'une réponse reste légère même après une longue absence. */
export const ACTIVITY_LIMIT = 500;

@Injectable()
export class ActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appointments: AppointmentsService,
  ) {}

  /**
   * Ce qui est arrivé depuis `since` (id et date de création seulement) pour les pastilles « nouveau » du site :
   * rendez-vous pris par un client connecté (en attente ou confirmés, avec les règles de visibilité de la liste du salon),
   * suivis de cicatrisation et avis visibles. Un compte gratuit ne voit que les avis.
   */
  async recent(userId: string, sinceMs?: number): Promise<RecentActivity> {
    const oldest = Date.now() - ACTIVITY_MAX_DAYS * 86_400_000;
    const since = new Date(Number.isFinite(sinceMs) ? Math.max(sinceMs as number, oldest) : oldest);

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { saasPlan: true } });
    const free = user?.saasPlan === SaasPlan.FREE;

    const [appointments, followUps, reviews] = await Promise.all([
      free ? [] : this.appointments.findRecentClientBookings(userId, since, ACTIVITY_LIMIT),
      free
        ? []
        : this.prisma.followUpSubmission.findMany({
            where: { userId, createdAt: { gte: since } },
            select: { id: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: ACTIVITY_LIMIT,
          }),
      this.prisma.salonReview.findMany({
        where: { salonId: userId, isVisible: true, createdAt: { gte: since } },
        select: { id: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: ACTIVITY_LIMIT,
      }),
    ]);
    return { appointments, followUps, reviews };
  }
}
