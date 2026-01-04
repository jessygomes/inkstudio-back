import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { RequestWithUser } from '../../../auth/jwt.strategy';
import { Conversation } from '@prisma/client';

interface RequestWithConversation extends RequestWithUser {
  conversation?: Conversation;
}

@Injectable()
export class ConversationAccessGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithConversation>();
    const user = request.user;
    const conversationId = request.params.id || request.params.conversationId;

    if (!user || !conversationId) {
      throw new ForbiddenException("Accès refusé");
    }

    // Récupérer la conversation
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation non trouvée');
    }

    // Vérifier que l'utilisateur est participant
    const isParticipant =
      conversation.salonId === user.userId || conversation.clientUserId === user.userId;

    if (!isParticipant) {
      throw new ForbiddenException(
        "Vous n'avez pas accès à cette conversation",
      );
    }

    // Ajouter la conversation dans la requête pour éviter une nouvelle requête
    request.conversation = conversation;

    return true;
  }
}
