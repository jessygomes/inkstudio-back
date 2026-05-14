import { BadRequestException, Injectable } from '@nestjs/common';
import { SalonProfileView } from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';
import { CreateSalonProfileViewDto } from './dto/create-salon-profile-view.dto';

type GroupableField = 'deviceType' | 'referrer' | 'country' | 'city';

@Injectable()
export class SalonAnalyticsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Enregistre une visite du profil public d'un salon
    * Retourne: la ligne SalonProfileView créée en base (id, salonId, viewerIpHash,
    * referrer, userAgent, deviceType, country, city, createdAt).
   */
  async trackProfileView(createViewDto: CreateSalonProfileViewDto) {
    const salon = await this.prisma.user.findUnique({
      where: { id: createViewDto.salonId },
      select: { id: true },
    });

    if (!salon) {
      throw new BadRequestException('salonId invalide.');
    }

    return this.prisma.salonProfileView.create({
      data: {
        salonId: createViewDto.salonId,
        viewerIpHash: createViewDto.ipHash,
        referrer: createViewDto.referrer,
        userAgent: createViewDto.userAgent,
        deviceType: createViewDto.deviceType,
        country: createViewDto.country,
        city: createViewDto.city,
      },
    });
  }

  /**
   * Récupère les statistiques des visites d'un salon
    * Retourne: un objet d'analytics agrégé contenant:
    * - totalViews: nombre total de vues sur la période
    * - uniqueVisitors: nombre de visiteurs uniques (basé sur viewerIpHash)
    * - averageViewsPerDay: moyenne des vues par jour
    * - viewsByDay: dictionnaire { YYYY-MM-DD: count }
    * - viewsByDeviceType: dictionnaire { deviceType: count } trié décroissant
    * - viewsByReferrer: dictionnaire { referrer: count } trié décroissant
    * - viewsByCountry: dictionnaire { country: count } trié décroissant
    * - viewsByCity: dictionnaire { city: count } trié décroissant
    * - period: { startDate, endDate, days }
    * - lastUpdated: date de génération de la réponse
   */
  async getSalonAnalytics(salonId: string, days: number = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const views = await this.prisma.salonProfileView.findMany({
      where: {
        salonId,
        createdAt: {
          gte: startDate,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Statistiques agrégées
    const totalViews = views.length;
    const uniqueVisitors = new Set(views.map((v) => v.viewerIpHash)).size;
    const viewsByDay = this.groupViewsByDay(views);
    const viewsByDeviceType = this.groupByField(views, 'deviceType');
    const viewsByReferrer = this.groupByField(views, 'referrer');
    const viewsByCountry = this.groupByField(views, 'country');
    const viewsByCity = this.groupByField(views, 'city');

    return {
      totalViews,
      uniqueVisitors,
      averageViewsPerDay: totalViews / days,
      viewsByDay,
      viewsByDeviceType,
      viewsByReferrer,
      viewsByCountry,
      viewsByCity,
      period: {
        startDate,
        endDate: new Date(),
        days,
      },
      lastUpdated: new Date(),
    };
  }

  /**
   * Récupère les statistiques en temps réel (dernières 24h)
    * Retourne:
    * - views24h: nombre total de vues sur les 24 dernières heures
    * - uniqueVisitors24h: nombre de visiteurs uniques sur 24h
    * - byHour: dictionnaire { "H:00": count }
   */
  async getRealTimeAnalytics(salonId: string) {
    const last24h = new Date();
    last24h.setHours(last24h.getHours() - 24);

    const views = await this.prisma.salonProfileView.findMany({
      where: {
        salonId,
        createdAt: {
          gte: last24h,
        },
      },
    });

    return {
      views24h: views.length,
      uniqueVisitors24h: new Set(views.map((v) => v.viewerIpHash)).size,
      byHour: this.groupViewsByHour(views),
    };
  }

  /**
   * Récupère les statistiques comparatives pour le dashboard
    * Retourne:
    * - viewsLast30Days: vues sur les 30 derniers jours
    * - viewsPrevious30Days: vues sur les 30 jours précédents
    * - percentageChange: évolution en pourcentage
    * - trend: 'UP' | 'DOWN' | 'STABLE'
   */
  async getComparativeAnalytics(salonId: string) {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const viewsLast30Days = await this.prisma.salonProfileView.count({
      where: {
        salonId,
        createdAt: {
          gte: thirtyDaysAgo,
          lt: now,
        },
      },
    });

    const viewsPrevious30Days = await this.prisma.salonProfileView.count({
      where: {
        salonId,
        createdAt: {
          gte: sixtyDaysAgo,
          lt: thirtyDaysAgo,
        },
      },
    });

    const deltaViews = viewsLast30Days - viewsPrevious30Days;

    // Cas limite: évite un faux +100% quand il n'y a aucune vue sur les 2 périodes.
    const rawPercentageChange =
      viewsPrevious30Days === 0
        ? viewsLast30Days === 0
          ? 0
          : 100
        : (deltaViews / viewsPrevious30Days) * 100;

    // Arrondi pour stabiliser l'affichage dashboard (évite le bruit flottant).
    const percentageChange = Number(rawPercentageChange.toFixed(2));
    const trendThreshold = 0.01;

    return {
      viewsLast30Days,
      viewsPrevious30Days,
      deltaViews,
      percentageChange,
      trend:
        percentageChange > trendThreshold
          ? 'UP'
          : percentageChange < -trendThreshold
            ? 'DOWN'
            : 'STABLE',
    };
  }

  /**
   * Récupère le top des salons par nombre de visites
    * Retourne un tableau trié (desc) avec, pour chaque entrée:
    * - salon: { id, salonName, city } ou null si le salon n'est plus trouvé
    * - viewCount: nombre de vues sur la période
   */
  async getTopSalonsByViews(limit: number = 10, days: number = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const result = await this.prisma.salonProfileView.groupBy({
      by: ['salonId'],
      where: {
        createdAt: {
          gte: startDate,
        },
      },
      _count: {
        id: true,
      },
      orderBy: {
        _count: {
          id: 'desc',
        },
      },
      take: limit,
    });

    const salonIds = result.map((item) => item.salonId);
    const salons = await this.prisma.user.findMany({
      where: { id: { in: salonIds } },
      select: { id: true, salonName: true, city: true },
    });

    const salonById = new Map(salons.map((salon) => [salon.id, salon]));
    const salonsWithViews = result.map((item) => ({
      salon: salonById.get(item.salonId) ?? null,
      viewCount: item._count.id,
    }));

    return salonsWithViews;
  }

  // =====================
  // HELPERS
  // =====================

  /**
   * Retourne un dictionnaire par jour: { YYYY-MM-DD: count }.
   */
  private groupViewsByDay(views: SalonProfileView[]) {
    const grouped: Record<string, number> = {};

    views.forEach((view) => {
      const date = new Date(view.createdAt).toISOString().split('T')[0];
      grouped[date] = (grouped[date] || 0) + 1;
    });

    return grouped;
  }

  /**
   * Retourne un dictionnaire par heure: { "H:00": count }.
   */
  private groupViewsByHour(views: SalonProfileView[]) {
    const grouped: Record<string, number> = {};

    views.forEach((view) => {
      const hour = new Date(view.createdAt).getHours();
      const key = `${hour}:00`;
      grouped[key] = (grouped[key] || 0) + 1;
    });

    return grouped;
  }

  /**
   * Retourne un dictionnaire { valeurDuChamp: count } trié par volume décroissant.
   */
  private groupByField(views: SalonProfileView[], field: GroupableField) {
    const grouped: Record<string, number> = {};

    views.forEach((view) => {
      const value = view[field] || 'unknown';
      grouped[value] = (grouped[value] || 0) + 1;
    });

    return Object.entries(grouped)
      .sort((a, b) => b[1] - a[1])
      .reduce((obj, [key, value]) => {
        obj[key] = value;
        return obj;
      }, {} as Record<string, number>);
  }
}
