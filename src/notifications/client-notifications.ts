import type { PrismaService } from '../database/prisma.service';
import type { NotificationsService } from './notifications.service';

// Notifications envoyées aux clients (app People) depuis plusieurs modules. Ne lèvent jamais d'erreur.

const parisDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/** Compte client à prévenir pour un rendez-vous : celui qui a réservé, sinon celui relié à la fiche. */
export const appointmentClientUserId = (a: { clientUserId?: string | null; client?: { linkedUserId?: string | null } | null }) =>
  a.clientUserId || a.client?.linkedUserId || null;

/**
 * Nouveau flash ou nouvelles réalisations d'un salon : prévient les clients qui l'ont en favori.
 * Une seule notification par client, par salon, par type et par jour (un ajout de 10 photos n'en envoie qu'une).
 */
export async function notifyFavoritesOfNewWork(
  prisma: PrismaService,
  notifications: NotificationsService | undefined,
  salonUserId: string,
  kind: 'flash' | 'portfolio',
  now = new Date(),
) {
  if (!notifications) return;
  try {
    const salon = await prisma.user.findUnique({
      where: { id: salonUserId },
      select: { salonName: true, nickname: true, firstName: true, lastName: true, role: true, publicVisibility: true },
    });
    if (!salon || salon.publicVisibility === 'HIDDEN') return;
    const name = (salon.role === 'user_tatoueur' && salon.nickname) || salon.salonName || [salon.firstName, salon.lastName].filter(Boolean).join(' ') || 'Un salon';
    const fans = await prisma.favoriteUser.findMany({ where: { salonId: salonUserId }, select: { clientId: true }, take: 5000 });
    const day = parisDate(now);
    for (const { clientId } of fans) {
      await notifications.notify({
        userId: clientId,
        type: kind === 'flash' ? 'client.salon_new_flash' : 'client.salon_new_portfolio',
        title: kind === 'flash' ? `${name} a publié un nouveau flash` : `Nouvelles réalisations chez ${name}`,
        body: kind === 'flash' ? 'Découvrez-le avant qu’il ne soit réservé.' : 'Allez voir les dernières pièces de son portfolio.',
        data: { salonId: salonUserId },
        dedupeKey: `fav-${kind}:${salonUserId}:${day}`,
      });
    }
  } catch {
    // Les favoris ne doivent jamais faire échouer la création du flash ou de la photo.
  }
}
