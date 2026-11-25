import { Body, Controller, Param, Post, Request, UseGuards } from '@nestjs/common';
import { IsBoolean, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RequestWithUser } from '../../auth/jwt.strategy';
import { ClientAccessService } from './client-access.service';

export class StartFromFavoriteDto {
  @IsString() @MaxLength(64) clientUserId: string;
}

export class RespondClientAccessDto {
  @IsBoolean() accept: boolean;
}

/**
 * Contact d'un client qui a mis une réalisation ou un flash en favori, et demande d'accès à ses informations.
 * Voir ClientAccessService.
 */
@Controller('messaging/client-access')
@UseGuards(JwtAuthGuard)
export class ClientAccessController {
  constructor(private readonly access: ClientAccessService) {}

  /** Professionnel : ouvre (ou retrouve) la conversation avec le client. Réponse : { conversationId, created }. */
  @Post('start')
  start(@Request() req: RequestWithUser, @Body() dto: StartFromFavoriteDto) {
    return this.access.startFromFavorite(req.user.userId, dto.clientUserId);
  }

  /** Professionnel : demande l'accès aux informations du client. */
  @Post(':conversationId/request')
  request(@Request() req: RequestWithUser, @Param('conversationId') conversationId: string) {
    return this.access.requestAccess(req.user.userId, conversationId);
  }

  /** Client : répond oui / non à la demande. */
  @Post(':conversationId/respond')
  respond(@Request() req: RequestWithUser, @Param('conversationId') conversationId: string, @Body() dto: RespondClientAccessDto) {
    return this.access.respond(req.user.userId, conversationId, this.access.assertBody(dto.accept));
  }
}
