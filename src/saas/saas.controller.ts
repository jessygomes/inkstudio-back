import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequestWithUser } from '../auth/jwt.strategy';
import { CheckFeatureDto } from './dto/check-feature.dto';
import { SaasService } from './saas.service';

@Controller('saas')
@UseGuards(JwtAuthGuard)
export class SaasController {
  constructor(private readonly saasService: SaasService) {}

  @Get('plan/:userId')
  @Header('Cache-Control', 'private, no-store')
  getPlanDetails(
    @Param('userId') userId: string,
    @Request() req: RequestWithUser,
  ) {
    if (req.user.userId !== userId && req.user.role !== 'admin') {
      throw new ForbiddenException('Accès non autorisé à cet abonnement.');
    }
    return this.saasService.getUserPlanDetails(userId);
  }

  @Post('check-feature')
  @Header('Cache-Control', 'private, no-store')
  async checkFeature(
    @Request() req: RequestWithUser,
    @Body() body: CheckFeatureDto,
  ) {
    const available = await this.saasService.hasFeature(
      req.user.userId,
      body.feature,
    );
    return { feature: body.feature, available };
  }

  // Plan changes go through authenticated Stripe flows or the audited admin
  // subscription endpoint. Legacy upgrade and repair routes are intentionally removed.
}
