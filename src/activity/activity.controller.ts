import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { RequestWithUser } from 'src/auth/jwt.strategy';
import { ActivityService } from './activity.service';

@ApiTags('activity')
@ApiBearerAuth('access-token')
@Controller('activity')
@UseGuards(JwtAuthGuard)
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get('recent')
  @ApiOperation({ summary: 'Nouveaux rendez-vous clients, suivis et avis depuis une date (id et date de création seulement)' })
  @ApiQuery({ name: 'since', required: false, example: 1762000000000, description: 'Date de départ en millisecondes (limitée aux 30 derniers jours).' })
  recent(@Request() req: RequestWithUser, @Query('since') since?: string) {
    const parsed = since ? Number(since) : undefined;
    return this.activity.recent(req.user.userId, parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined);
  }
}
