import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { RequestWithUser } from 'src/auth/jwt.strategy';
import { DASHBOARD_SECTIONS, DashboardService, type DashboardSectionName } from './dashboard.service';

@ApiTags('dashboard')
@ApiBearerAuth('access-token')
@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @ApiOperation({ summary: "Données de l'accueil en une seule requête (chaque bloc réussit ou échoue seul)" })
  @ApiQuery({ name: 'date', required: false, example: '2026-11-12', description: 'Jour des rendez-vous (défaut : aujourd\'hui).' })
  @ApiQuery({ name: 'fillStart', required: false, description: 'Début de la période du taux de remplissage (ISO).' })
  @ApiQuery({ name: 'fillEnd', required: false, description: 'Fin de la période du taux de remplissage (ISO).' })
  @ApiQuery({ name: 'month', required: false, example: 11 })
  @ApiQuery({ name: 'year', required: false, example: 2026 })
  @ApiQuery({ name: 'sections', required: false, description: `Blocs voulus, séparés par des virgules (${DASHBOARD_SECTIONS.join(', ')}). Tous par défaut.` })
  summary(
    @Request() req: RequestWithUser,
    @Query('date') date?: string,
    @Query('fillStart') fillStart?: string,
    @Query('fillEnd') fillEnd?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('sections') sections?: string,
  ) {
    const wanted = (sections ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is DashboardSectionName => (DASHBOARD_SECTIONS as readonly string[]).includes(s));
    return this.dashboard.summary(
      req.user.userId,
      {
        date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined,
        fillStart: fillStart && !Number.isNaN(Date.parse(fillStart)) ? fillStart : undefined,
        fillEnd: fillEnd && !Number.isNaN(Date.parse(fillEnd)) ? fillEnd : undefined,
        month: month ? Number(month) : undefined,
        year: year ? Number(year) : undefined,
      },
      wanted,
    );
  }
}
