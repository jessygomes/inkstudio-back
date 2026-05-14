import { Injectable } from '@nestjs/common';
import { SalonProfileView } from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';
import { CreateSalonProfileViewDto } from './dto/create-salon-profile-view.dto';

type GroupableField = 'deviceType' | 'referrer' | 'country' | 'city';

@Injectable()
export class SalonAnalyticsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Enregistre une visite du profil public d'un salon
   */
  trackProfileView(createViewDto: CreateSalonProfileViewDto) {
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

    const percentageChange =
      viewsPrevious30Days === 0
        ? 100
        : ((viewsLast30Days - viewsPrevious30Days) / viewsPrevious30Days) * 100;

    return {
      viewsLast30Days,
      viewsPrevious30Days,
      percentageChange,
      trend: percentageChange > 0 ? 'UP' : percentageChange < 0 ? 'DOWN' : 'STABLE',
    };
  }

  /**
   * Récupère le top des salons par nombre de visites
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

  private groupViewsByDay(views: SalonProfileView[]) {
    const grouped: Record<string, number> = {};

    views.forEach((view) => {
      const date = new Date(view.createdAt).toISOString().split('T')[0];
      grouped[date] = (grouped[date] || 0) + 1;
    });

    return grouped;
  }

  private groupViewsByHour(views: SalonProfileView[]) {
    const grouped: Record<string, number> = {};

    views.forEach((view) => {
      const hour = new Date(view.createdAt).getHours();
      const key = `${hour}:00`;
      grouped[key] = (grouped[key] || 0) + 1;
    });

    return grouped;
  }

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
