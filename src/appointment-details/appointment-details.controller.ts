import { Controller, Get, Param, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { RequestWithUser } from 'src/auth/jwt.strategy';
import { AppointmentDetailsService } from './appointment-details.service';

@ApiTags('appointments')
@ApiBearerAuth('access-token')
@Controller('appointments')
@UseGuards(JwtAuthGuard)
export class AppointmentDetailsController {
  constructor(private readonly details: AppointmentDetailsService) {}

  @Get(':id/details')
  @ApiOperation({ summary: "Fiche d'un rendez-vous en une requête : rendez-vous (avec client et conversation), photos, état du suivi de dessin" })
  get(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.details.get(req.user.userId, id);
  }
}
