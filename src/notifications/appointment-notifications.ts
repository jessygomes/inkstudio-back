import { NotificationsService } from './notifications.service';

type Rdv = {
  id: string;
  userId: string;
  performerUserId?: string | null;
  clientUserId?: string | null;
  title?: string | null;
  start: Date | string;
};

const TZ = 'Europe/Paris';

/** "samedi 8 nov. à 14h30" */
export function formatRdvWhen(start: Date | string): string {
  const d = new Date(start);
  const day = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short', timeZone: TZ });
  const parts = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TZ }).formatToParts(d);
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${day} à ${h}h${m}`;
}

const proIds = (rdv: Rdv) => [rdv.userId, rdv.performerUserId];
const link = (rdv: Rdv) => ({ appointmentId: rdv.id });

/** Un client a pris rendez-vous (en attente de confirmation ou confirmé d'office). */
export function notifyNewBooking(n: NotificationsService | undefined, rdv: Rdv, clientName: string, pending: boolean) {
  return n?.notifyMany(proIds(rdv), {
    type: 'appointment.created',
    title: pending ? 'Nouvelle demande de rendez-vous' : 'Nouveau rendez-vous',
    body: `${clientName || 'Un client'} · ${formatRdvWhen(rdv.start)}${pending ? ' · à confirmer' : ''}`,
    data: link(rdv),
  });
}

/**
 * Réservation d'un compte client (e-mail vérifié) rattachée à une fiche existante de même e-mail mais d'un autre nom :
 * la fiche n'est pas reliée au compte ; le salon peut inviter le client depuis la fiche.
 */
export function notifyBookingNameMismatch(
  n: NotificationsService | undefined,
  p: { salonId: string; appointmentId: string; client: { id: string; firstName?: string | null; lastName?: string | null; email?: string | null }; bookedAs: string },
) {
  const ficheName = [p.client.firstName, p.client.lastName].filter(Boolean).join(' ').trim() || 'votre client';
  return n?.notify({
    userId: p.salonId,
    type: 'client.booking_name_mismatch',
    title: `Réservation de ${p.bookedAs || 'un client'} rattachée à la fiche de ${ficheName}`,
    body: 'Même e-mail, nom différent : vérifiez la fiche. Pour que le client retrouve ses rendez-vous dans son espace, invitez-le depuis sa fiche.',
    data: { clientId: p.client.id, clientEmail: p.client.email ?? null, appointmentId: p.appointmentId },
    dedupeKey: `client.booking_name_mismatch:${p.appointmentId}`,
  });
}

/** Le client a annulé son rendez-vous. */
export function notifyClientCancelled(n: NotificationsService | undefined, rdv: Rdv, clientName: string, reason?: string) {
  return n?.notifyMany(proIds(rdv), {
    type: 'appointment.cancelled_by_client',
    title: 'Rendez-vous annulé par le client',
    body: `${clientName || 'Un client'} · ${formatRdvWhen(rdv.start)}${reason ? ` · « ${reason.slice(0, 120)} »` : ''}`,
    data: link(rdv),
  });
}

/** Le salon a confirmé le rendez-vous. */
export function notifyClientConfirmed(n: NotificationsService | undefined, rdv: Rdv, salonName?: string | null) {
  if (!rdv.clientUserId) return undefined;
  return n?.notify({
    userId: rdv.clientUserId,
    type: 'client.appointment_confirmed',
    title: 'Rendez-vous confirmé',
    body: `${salonName ? `${salonName} · ` : ''}${formatRdvWhen(rdv.start)}`,
    data: link(rdv),
  });
}

/** Le salon a refusé (demande en attente) ou annulé (rendez-vous confirmé) le rendez-vous. */
export function notifyClientCancelledBySalon(n: NotificationsService | undefined, rdv: Rdv, wasPending: boolean, salonName?: string | null) {
  if (!rdv.clientUserId) return undefined;
  return n?.notify({
    userId: rdv.clientUserId,
    type: wasPending ? 'client.appointment_declined' : 'client.appointment_cancelled',
    title: wasPending ? 'Demande de rendez-vous refusée' : 'Rendez-vous annulé',
    body: `${salonName ? `${salonName} · ` : ''}${formatRdvWhen(rdv.start)}`,
    data: link(rdv),
  });
}

/** Le salon a déplacé le rendez-vous. */
export function notifyClientRescheduled(n: NotificationsService | undefined, rdv: Rdv, salonName?: string | null) {
  if (!rdv.clientUserId) return undefined;
  return n?.notify({
    userId: rdv.clientUserId,
    type: 'client.appointment_changed',
    title: 'Rendez-vous modifié',
    body: `${salonName ? `${salonName} · ` : ''}nouvel horaire : ${formatRdvWhen(rdv.start)}`,
    data: link(rdv),
  });
}

/** Le client a déplacé son rendez-vous. */
export function notifyClientRescheduledByClient(n: NotificationsService | undefined, rdv: Rdv, clientName: string) {
  return n?.notifyMany(proIds(rdv), {
    type: 'appointment.updated',
    title: 'Rendez-vous modifié par le client',
    body: `${clientName || 'Un client'} · nouvel horaire : ${formatRdvWhen(rdv.start)}`,
    data: link(rdv),
  });
}

/** Un rendez-vous a été créé par le salon pour un artiste lié (compte Pro) : l'artiste est prévenu. */
export function notifyPerformerAssigned(n: NotificationsService | undefined, rdv: Rdv, createdBy: string, clientName: string) {
  if (!rdv.performerUserId || rdv.performerUserId === createdBy) return undefined;
  return n?.notify({
    userId: rdv.performerUserId,
    type: 'appointment.created',
    title: 'Nouveau rendez-vous dans votre agenda',
    body: `${clientName || 'Client'} · ${formatRdvWhen(rdv.start)}`,
    data: link(rdv),
  });
}
