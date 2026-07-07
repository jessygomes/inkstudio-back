import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { SalonAnalyticsService } from './salon-analytics.service';
import { CreateSalonProfileViewDto } from './dto/create-salon-profile-view.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { RequestWithUser } from 'src/auth/jwt.strategy';
import { SaasLimitGuard } from 'src/saas/saas-limit.guard';
import { SaasLimit } from 'src/saas/saas-limit.decorator';

@Controller('salon-analytics')
export class SalonAnalyticsController {
  constructor(private readonly salonAnalyticsService: SalonAnalyticsService) {}

  /**
   * POST /salon-analytics/track
   * Enregistre une visite du profil public (publique - pas d'auth requise)
   */
  @Post('track')
  trackProfileView(@Body() body: CreateSalonProfileViewDto) {
    return this.salonAnalyticsService.trackProfileView(body);
  }

  /**
   * GET /salon-analytics/:salonId/stats
   * Récupère les statistiques d'un salon (protégé - auth requise)
   */
  @Get(':salonId/stats')
  @UseGuards(JwtAuthGuard, SaasLimitGuard)
  @SaasLimit('dashboard')
  async getSalonStats(
    @Param('salonId') salonId: string,
    @Query('days') days: string = '30',
    @Request() req: RequestWithUser,
  ) {
    const userId = req.user.userId;
    const parsedDays = Number.parseInt(days, 10);

    if (Number.isNaN(parsedDays) || parsedDays <= 0) {
      throw new BadRequestException('Le paramètre days doit être un entier positif.');
    }

    // Vérifier que l'utilisateur est propriétaire du salon
    if (userId !== salonId) {
      throw new ForbiddenException('Acces non autorise a ces statistiques.');
    }

    return this.salonAnalyticsService.getSalonAnalytics(salonId, parsedDays);
  }

  /**
   * GET /salon-analytics/:salonId/realtime
   * Récupère les stats temps réel (dernières 24h)
   */
  @Get(':salonId/realtime')
  @UseGuards(JwtAuthGuard, SaasLimitGuard)
  @SaasLimit('dashboard')
  async getRealTimeStats(
    @Param('salonId') salonId: string,
    @Request() req: RequestWithUser,
  ) {
    const userId = req.user.userId;

    if (userId !== salonId) {
      throw new ForbiddenException('Acces non autorise a ces statistiques.');
    }

    return this.salonAnalyticsService.getRealTimeAnalytics(salonId);
  }

  /**
   * GET /salon-analytics/:salonId/comparative
   * Récupère les stats comparatives (30j vs 30j précédents)
   */
  @Get(':salonId/comparative')
  @UseGuards(JwtAuthGuard, SaasLimitGuard)
  @SaasLimit('dashboard')
  async getComparativeStats(
    @Param('salonId') salonId: string,
    @Request() req: RequestWithUser,
  ) {
    const userId = req.user.userId;

    if (userId !== salonId) {
      throw new ForbiddenException('Acces non autorise a ces statistiques.');
    }

    return this.salonAnalyticsService.getComparativeAnalytics(salonId);
  }

  /**
   * GET /salon-analytics/top-salons
   * Récupère le top des salons (admin seulement)
   */
  @Get('admin/top-salons')
  @UseGuards(JwtAuthGuard)
  async getTopSalons(
    @Query('limit') limit: string = '10',
    @Query('days') days: string = '30',
    @Request() req: RequestWithUser,
  ) {
    const role = req.user.role;
    const parsedLimit = Number.parseInt(limit, 10);
    const parsedDays = Number.parseInt(days, 10);

    if (role !== 'admin') {
      throw new ForbiddenException('Acces reserve aux administrateurs.');
    }

    if (Number.isNaN(parsedLimit) || parsedLimit <= 0) {
      throw new BadRequestException('Le paramètre limit doit être un entier positif.');
    }

    if (Number.isNaN(parsedDays) || parsedDays <= 0) {
      throw new BadRequestException('Le paramètre days doit être un entier positif.');
    }

    return this.salonAnalyticsService.getTopSalonsByViews(
      parsedLimit,
      parsedDays,
    );
  }
}
