import { Body, Controller, Get, Header, Param, Patch, Post, Query, Request, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequestWithUser } from '../auth/jwt.strategy';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  ActivateAwardDto,
  AmendGiveawayDto,
  ConfirmActionDto,
  CreateGiveawayDto,
  DuplicateGiveawayDto,
  EntriesQueryDto,
  ReasonDto,
  ReviewEntryDto,
  UpdateGiveawayDto,
  VoidDrawDto,
} from './dto/giveaway.dto';
import { GiveawayAdminGuard } from './giveaway-admin.guard';
import { giveawayOptions } from './giveaway-options';
import { GiveawaysAdminService } from './giveaways-admin.service';

/** Administration des concours (rôle admin vérifié dans le jeton ET en base). Routes statiques avant les routes paramétrées. */
@ApiTags('Giveaways (admin)')
@ApiBearerAuth('access-token')
@Controller('admin/giveaways')
@UseGuards(JwtAuthGuard, RolesGuard, GiveawayAdminGuard)
@Roles('admin')
export class GiveawaysAdminController {
  constructor(private readonly admin: GiveawaysAdminService) {}

  @Get()
  list(@Query('includeArchived') includeArchived?: string) {
    return this.admin.list(includeArchived === 'true');
  }

  @Post()
  create(@Body() body: CreateGiveawayDto, @Request() req: RequestWithUser) {
    return this.admin.create(body, req.user.userId);
  }

  @Get('options')
  options() {
    return giveawayOptions();
  }

  // Lots et tirages (segments statiques)
  @Post('awards/:awardId/confirm')
  confirmAward(@Param('awardId') awardId: string, @Request() req: RequestWithUser) {
    return this.admin.confirmAward(awardId, req.user.userId);
  }

  @Post('awards/:awardId/forfeit')
  forfeitAward(@Param('awardId') awardId: string, @Body() body: ReasonDto, @Request() req: RequestWithUser) {
    return this.admin.forfeitAward(awardId, body.reason, req.user.userId);
  }

  @Post('awards/:awardId/activation/preview')
  activationPreview(@Param('awardId') awardId: string) {
    return this.admin.activationPreview(awardId);
  }

  @Post('awards/:awardId/activate')
  activate(@Param('awardId') awardId: string, @Body() body: ActivateAwardDto, @Request() req: RequestWithUser) {
    return this.admin.activate(awardId, body, req.user.userId);
  }

  @Post('awards/:awardId/cancel')
  cancelAward(@Param('awardId') awardId: string, @Body() body: ReasonDto, @Request() req: RequestWithUser) {
    return this.admin.cancelAward(awardId, body.reason, req.user.userId);
  }

  @Get('draws/:drawId')
  drawView(@Param('drawId') drawId: string) {
    return this.admin.drawView(drawId);
  }

  @Post('draws/:drawId/promote-alternate')
  promoteAlternate(@Param('drawId') drawId: string, @Request() req: RequestWithUser) {
    return this.admin.promoteAlternate(drawId, req.user.userId);
  }

  @Post('draws/:drawId/notify-alternates')
  notifyAlternates(@Param('drawId') drawId: string, @Request() req: RequestWithUser) {
    return this.admin.notifyAlternates(drawId, req.user.userId);
  }

  // Concours
  @Get(':id')
  detail(@Param('id') id: string) {
    return this.admin.detail(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateGiveawayDto, @Request() req: RequestWithUser) {
    return this.admin.update(id, body, req.user.userId);
  }

  @Post(':id/amendments')
  amend(@Param('id') id: string, @Body() body: AmendGiveawayDto, @Request() req: RequestWithUser) {
    return this.admin.amend(id, body, req.user.userId);
  }

  @Post(':id/rules/approve')
  approveRules(@Param('id') id: string, @Request() req: RequestWithUser) {
    return this.admin.approveRules(id, req.user.userId);
  }

  @Post(':id/publish')
  publish(@Param('id') id: string, @Request() req: RequestWithUser) {
    return this.admin.publish(id, req.user.userId);
  }

  @Post(':id/unpublish')
  unpublish(@Param('id') id: string, @Request() req: RequestWithUser) {
    return this.admin.unpublish(id, req.user.userId);
  }

  @Post(':id/archive')
  archive(@Param('id') id: string, @Request() req: RequestWithUser) {
    return this.admin.archive(id, req.user.userId);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Body() body: ReasonDto, @Request() req: RequestWithUser) {
    return this.admin.cancel(id, body.reason, req.user.userId);
  }

  @Post(':id/duplicate')
  duplicate(@Param('id') id: string, @Body() body: DuplicateGiveawayDto, @Request() req: RequestWithUser) {
    return this.admin.duplicate(id, body, req.user.userId);
  }

  @Get(':id/entries')
  entries(@Param('id') id: string, @Query() query: EntriesQueryDto) {
    return this.admin.entries(id, query);
  }

  @Get(':id/entries/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'private, no-store')
  async exportEntries(@Param('id') id: string, @Request() req: RequestWithUser, @Res({ passthrough: true }) res: Response) {
    const { filename, content } = await this.admin.exportCsv(id, req.user.userId);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return content;
  }

  @Post(':id/entries/:entryId/review')
  review(@Param('id') id: string, @Param('entryId') entryId: string, @Body() body: ReviewEntryDto, @Request() req: RequestWithUser) {
    return this.admin.reviewEntry(id, entryId, body.decision, body.note, req.user.userId);
  }

  @Get(':id/stats')
  stats(@Param('id') id: string) {
    return this.admin.stats(id);
  }

  @Post(':id/eligibility-check')
  eligibilityReport(@Param('id') id: string) {
    return this.admin.eligibilityReport(id);
  }

  @Post(':id/freeze')
  freeze(@Param('id') id: string, @Body() body: ConfirmActionDto, @Request() req: RequestWithUser) {
    return this.admin.freeze(id, body.confirmation, req.user.userId);
  }

  @Post(':id/categories/:categoryId/draw')
  draw(@Param('id') id: string, @Param('categoryId') categoryId: string, @Body() body: ConfirmActionDto, @Request() req: RequestWithUser) {
    return this.admin.draw(id, categoryId, body.confirmation, req.user.userId);
  }

  @Post(':id/draws/:drawId/void')
  voidDraw(@Param('id') id: string, @Param('drawId') drawId: string, @Body() body: VoidDrawDto, @Request() req: RequestWithUser) {
    return this.admin.voidDraw(id, drawId, body.reason, body.confirmation, req.user.userId);
  }

  @Get(':id/results')
  results(@Param('id') id: string) {
    return this.admin.adminResults(id);
  }

  @Post(':id/results/publish')
  publishResults(@Param('id') id: string, @Request() req: RequestWithUser) {
    return this.admin.publishResults(id, req.user.userId);
  }

  @Post(':id/complete')
  complete(@Param('id') id: string, @Request() req: RequestWithUser) {
    return this.admin.complete(id, req.user.userId);
  }

  @Post(':id/purge-personal-data')
  purge(@Param('id') id: string, @Request() req: RequestWithUser) {
    return this.admin.purgePersonalData(id, req.user.userId);
  }

  @Get(':id/audit')
  auditLog(@Param('id') id: string, @Query('page') page?: string) {
    const p = Number(page || 1);
    return this.admin.auditLog(id, Number.isInteger(p) && p > 0 ? Math.min(p, 10000) : 1);
  }
}
