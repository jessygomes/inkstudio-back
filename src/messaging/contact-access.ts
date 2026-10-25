import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';

export async function assertContactCanMessage(
  prisma: PrismaService,
  conversation: {
    salonId: string,
    clientUserId: string,
    projectContactPending?: boolean,
  },
) {
  const blocked = await prisma.professionalBlock.findUnique({
    where: {
      clientUserId_professionalId: {
        clientUserId: conversation.clientUserId,
        professionalId: conversation.salonId,
      },
    },
  });
  if (blocked) throw new ForbiddenException('Ce contact est bloqué.');
  if (conversation.projectContactPending)
    throw new ForbiddenException('La demande de contact doit être acceptée.');
}
