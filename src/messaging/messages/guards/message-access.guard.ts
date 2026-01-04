import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { RequestWithUser } from '../../../auth/jwt.strategy';
import { Message, Conversation } from '@prisma/client';

interface RequestWithMessage extends RequestWithUser {
  message?: Message & { conversation: Conversation };
}

@Injectable()
export class MessageAccessGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithMessage>();
    const user = request.user;
    const messageId = request.params.messageId || request.params.id;

    if (!user || !messageId) {
      throw new ForbiddenException("Accès refusé");
    }

    // Récupérer le message avec sa conversation
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: {
        conversation: true,
      },
    });

    if (!message) {
      throw new NotFoundException('Message non trouvé');
    }

    // Vérifier que l'utilisateur est participant de la conversation
    const isParticipant =
      message.conversation.salonId === user.userId ||
      message.conversation.clientUserId === user.userId;

    if (!isParticipant) {
      throw new ForbiddenException("Vous n'avez pas accès à ce message");
    }

    // Ajouter le message dans la requête
    request.message = message;

    return true;
  }
}
