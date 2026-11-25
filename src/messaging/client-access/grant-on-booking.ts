import { MessageType } from '@prisma/client';
import type { PrismaService } from '../../database/prisma.service';

const HIDDEN = ['HIDDEN', 'REQUESTED', 'DECLINED'];

/**
 * Le client a réservé lui-même un rendez-vous (réservation People ou lien de réservation) : en réservant, il partage ses
 * informations avec le professionnel. Ses conversations encore masquées avec ce professionnel (ouvertes après un favori)
 * passent donc en « accès accordé », et la fiche du rendez-vous est reliée au fil de messagerie.
 * Ne lève jamais d'erreur : la réservation est déjà enregistrée.
 */
export async function grantClientAccessOnBooking(
  prisma: PrismaService,
  booking: { professionalIds: (string | null | undefined)[]; clientUserId?: string | null; clientId?: string | null; clientOwnerId?: string | null },
): Promise<string[]> {
  try {
    const { clientUserId } = booking;
    const professionalIds = [...new Set(booking.professionalIds.filter((id): id is string => !!id))];
    if (!clientUserId || !professionalIds.length) return [];
    const conversations = await prisma.conversation.findMany({
      where: { clientUserId, salonId: { in: professionalIds }, clientAccess: { in: HIDDEN } },
      select: { id: true, salonId: true },
    });
    const granted: string[] = [];
    for (const conversation of conversations) {
      const claimed = await prisma.conversation.updateMany({
        where: { id: conversation.id, clientAccess: { in: HIDDEN } },
        data: { clientAccess: 'GRANTED', clientAccessRespondedAt: new Date() },
      });
      if (!claimed.count) continue;
      granted.push(conversation.id);
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderId: clientUserId,
          type: MessageType.SYSTEM,
          content: 'Le client a réservé un rendez-vous : ses informations sont maintenant partagées.',
        },
      });
      // La fiche n'est reliée au fil que si elle appartient au propriétaire de la conversation.
      if (booking.clientId && booking.clientOwnerId === conversation.salonId) {
        await prisma.inboxThread.updateMany({
          where: { conversationId: conversation.id, linkedClientId: null },
          data: { linkedClientId: booking.clientId },
        });
      }
    }
    return granted;
  } catch {
    return [];
  }
}
