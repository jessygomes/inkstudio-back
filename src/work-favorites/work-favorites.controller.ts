import { Controller, Get, Param, Patch, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { RequestWithUser } from 'src/auth/jwt.strategy';
import { WorkFavoritesService } from './work-favorites.service';

@Controller('work-favorites')
@UseGuards(JwtAuthGuard)
export class WorkFavoritesController {
  constructor(private readonly favorites: WorkFavoritesService) {}

  /** Client : flashs en favori. */
  @Get('flash')
  listFlashes(@Request() req: RequestWithUser) {
    return this.favorites.listFlashes(req.user.userId);
  }

  /** Client : identifiants des flashs en favori. */
  @Get('flash/ids')
  flashIds(@Request() req: RequestWithUser) {
    return this.favorites.flashIds(req.user.userId);
  }

  /** Client : ajoute / retire un flash des favoris (le professionnel est prévenu avec le pseudo du client). */
  @Patch('flash/:flashId')
  toggleFlash(@Request() req: RequestWithUser, @Param('flashId') flashId: string) {
    return this.favorites.toggleFlash(req.user.userId, req.user.role, flashId);
  }

  /** Professionnel : favoris reçus sur ses réalisations et ses flashs. */
  @Get('received')
  received(@Request() req: RequestWithUser, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.favorites.received(req.user.userId, req.user.role, Number(page) || 1, Number(limit) || 20);
  }
}
