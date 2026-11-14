import { Body, Controller, Delete, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SecurityThrottle } from '../auth/security-throttle';
import { ClientInvitationsService } from './client-invitations.service';

export class CreateClientInvitationDto {
  @IsOptional()
  @IsBoolean()
  sendEmail?: boolean;
}

type AuthRequest = { user: { userId: string } };

@ApiTags('Client invitations')
@Controller()
export class ClientInvitationsController {
  constructor(private readonly invitations: ClientInvitationsService) {}

  /** État de l'invitation d'une fiche (salon propriétaire). */
  @Get('clients/:id/invitation')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  status(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.invitations.status(req.user.userId, id);
  }

  /** Crée un lien d'invitation (et l'envoie par e-mail si `sendEmail`). Le lien n'est renvoyé qu'ici. */
  @Post('clients/:id/invitation')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  create(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: CreateClientInvitationDto) {
    return this.invitations.create(req.user.userId, id, { sendEmail: body?.sendEmail === true });
  }

  @Delete('clients/:id/invitation')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  revoke(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.invitations.revoke(req.user.userId, id);
  }

  /** Lecture publique du lien (page d'invitation du site People). */
  @Get('client-invitations/:token')
  @SecurityThrottle('clientInvitationRead')
  publicInfo(@Param('token') token: string) {
    return this.invitations.publicInfo(token);
  }

  /** Le client connecté relie son compte à sa fiche. */
  @SecurityThrottle('clientInvitationAccept')
  @UseGuards(JwtAuthGuard)
  @Post('client-invitations/:token/accept')
  @ApiBearerAuth('access-token')
  accept(@Request() req: AuthRequest, @Param('token') token: string) {
    return this.invitations.accept(token, req.user.userId);
  }
}
