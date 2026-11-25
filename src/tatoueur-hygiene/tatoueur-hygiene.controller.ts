import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { RequestWithUser } from 'src/auth/jwt.strategy';
import { Roles } from 'src/auth/roles.decorator';
import { RolesGuard } from 'src/auth/roles.guard';
import { TatoueurHygieneService } from './tatoueur-hygiene.service';

export class SubmitHygieneDocumentDto {
  @IsString() @MaxLength(2048) fileUrl: string;
}

export class ReviewHygieneDocumentDto {
  @IsIn(['APPROVED', 'REJECTED', 'PENDING']) status: 'APPROVED' | 'REJECTED' | 'PENDING';
  @IsOptional() @IsString() @MaxLength(1000) rejectionReason?: string;
}

/** Salon : justificatifs d'hygiène de ses tatoueurs internes. */
@Controller('tatoueur-hygiene')
@UseGuards(JwtAuthGuard)
export class TatoueurHygieneController {
  constructor(private readonly hygiene: TatoueurHygieneService) {}

  @Get()
  list(@Request() req: RequestWithUser) {
    return this.hygiene.listForSalon(req.user.userId, req.user.role);
  }

  @Get(':tatoueurId')
  get(@Request() req: RequestWithUser, @Param('tatoueurId') tatoueurId: string) {
    return this.hygiene.getForTatoueur(req.user.userId, req.user.role, tatoueurId);
  }

  @Post(':tatoueurId')
  submit(@Request() req: RequestWithUser, @Param('tatoueurId') tatoueurId: string, @Body() dto: SubmitHygieneDocumentDto) {
    return this.hygiene.submit(req.user.userId, req.user.role, tatoueurId, dto.fileUrl);
  }

  @Delete(':tatoueurId')
  remove(@Request() req: RequestWithUser, @Param('tatoueurId') tatoueurId: string) {
    return this.hygiene.remove(req.user.userId, req.user.role, tatoueurId);
  }
}

/** Administration : vérification des justificatifs d'hygiène des tatoueurs. */
@Controller('admin/tatoueur-hygiene')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminTatoueurHygieneController {
  constructor(private readonly hygiene: TatoueurHygieneService) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.hygiene.adminList({ status, search, page: Number(page) || 1, limit: Number(limit) || 20 });
  }

  @Patch(':id')
  review(@Request() req: RequestWithUser, @Param('id') id: string, @Body() dto: ReviewHygieneDocumentDto) {
    return this.hygiene.adminReview(req.user.userId, id, dto.status, dto.rejectionReason);
  }
}
