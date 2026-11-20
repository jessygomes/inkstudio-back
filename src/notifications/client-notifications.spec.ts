import { NotificationRemindersService } from './notification-reminders.service';
import { notifyFavoritesOfNewWork } from './client-notifications';

// Notifications des clients (app People) : rappels de rendez-vous, avis, Explorer, nouveautés des salons favoris.
function build(appointments: (args: any) => unknown[] = () => [], proposals: unknown[] = []) {
  const empty = jest.fn().mockResolvedValue([]);
  const prisma: any = {
    appointment: { findMany: jest.fn().mockImplementation(async (args: any) => appointments(args)), groupBy: empty },
    messageNotification: { findMany: empty },
    stockItem: { findMany: empty },
    user: { findMany: empty },
    salonReview: { groupBy: empty },
    projectProposal: { findMany: jest.fn().mockResolvedValue(proposals) },
  };
  const notifications: any = { notify: jest.fn().mockResolvedValue(null), purgeOlderThan: jest.fn().mockResolvedValue(0) };
  return { svc: new NotificationRemindersService(prisma, notifications), prisma, notifications };
}
const sent = (n: any, type: string) => n.notify.mock.calls.map((c: any[]) => c[0]).filter((x: any) => x.type === type);
const isClientReminderQuery = (args: any) => args.where.status === 'CONFIRMED' && Array.isArray(args.where.OR);
const salon = { salonName: 'Ink Studio' };

describe('Notifications des clients', () => {
  it('rappelle au client un rendez-vous 2 h avant (compte de la fiche si pas de réservation en ligne)', async () => {
    const now = new Date('2026-11-10T12:00:00Z');
    const { svc, notifications } = build((args) => (isClientReminderQuery(args)
      ? [{ id: 'a1', start: new Date('2026-11-10T13:30:00Z'), createdAt: new Date('2026-11-01T10:00:00Z'), clientUserId: null, client: { linkedUserId: 'client-1' }, user: salon }]
      : []));
    await svc.run(now);
    const [n] = sent(notifications, 'client.appointment_reminder');
    expect(n).toMatchObject({ userId: 'client-1', dedupeKey: 'client-2h:a1', data: { appointmentId: 'a1' } });
    expect(n.title).toBe('Rendez-vous à 14h30');
  });

  it('envoie le rappel de la veille à partir de 17 h, et seulement si le rendez-vous a été pris plus de 24 h avant', async () => {
    const start = new Date('2026-11-11T09:00:00Z'); // demain 10 h à Paris
    const rows = [
      { id: 'old', start, createdAt: new Date('2026-11-01T10:00:00Z'), clientUserId: 'c1', client: null, user: salon },
      { id: 'recent', start, createdAt: new Date('2026-11-10T15:00:00Z'), clientUserId: 'c2', client: null, user: salon },
    ];
    const morning = build((args) => (isClientReminderQuery(args) ? rows : []));
    await morning.svc.run(new Date('2026-11-10T09:00:00Z')); // 10 h à Paris : trop tôt
    expect(sent(morning.notifications, 'client.appointment_reminder')).toHaveLength(0);
    const evening = build((args) => (isClientReminderQuery(args) ? rows : []));
    await evening.svc.run(new Date('2026-11-10T17:00:00Z')); // 18 h à Paris
    const calls = sent(evening.notifications, 'client.appointment_reminder');
    expect(calls.map((n: any) => n.dedupeKey)).toEqual(['client-eve:old']);
    expect(calls[0].title).toBe('Demain à 10h00');
  });

  it('invite le client à donner son avis après une séance terminée, pendant la journée', async () => {
    const reviewQuery = (args: any) => args.where.status === 'COMPLETED' && args.where.salonReview === null;
    const rows = [{ id: 'a9', clientUserId: 'c9', client: null, user: salon }];
    const night = build((args) => (reviewQuery(args) ? rows : []));
    await night.svc.run(new Date('2026-11-10T22:30:00Z')); // 23 h 30 à Paris
    expect(sent(night.notifications, 'client.review_request')).toHaveLength(0);
    const day = build((args) => (reviewQuery(args) ? rows : []));
    await day.svc.run(new Date('2026-11-10T10:00:00Z'));
    expect(sent(day.notifications, 'client.review_request')[0]).toMatchObject({ userId: 'c9', dedupeKey: 'review-request:a9', data: { appointmentId: 'a9' } });
  });

  it('rappelle une proposition Explorer restée sans réponse', async () => {
    const { svc, notifications } = build(() => [], [{ id: 'p1', clientUserId: 'c3', moodboardId: 'm1', moodboard: { name: 'Fleurs' } }]);
    await svc.run(new Date('2026-11-10T10:00:00Z'));
    expect(sent(notifications, 'client.explorer_reminder')[0]).toMatchObject({ userId: 'c3', dedupeKey: 'explorer-reminder:p1', data: { moodboardId: 'm1' } });
  });

  it('prévient les clients qui ont le salon en favori, une fois par jour et par type', async () => {
    const prisma: any = {
      user: { findUnique: jest.fn().mockResolvedValue({ salonName: 'Ink Studio', role: 'user_salon', publicVisibility: 'VISIBLE' }) },
      favoriteUser: { findMany: jest.fn().mockResolvedValue([{ clientId: 'c1' }, { clientId: 'c2' }]) },
    };
    const notifications: any = { notify: jest.fn().mockResolvedValue(null) };
    await notifyFavoritesOfNewWork(prisma, notifications, 'salon-1', 'flash', new Date('2026-11-10T10:00:00Z'));
    expect(notifications.notify).toHaveBeenCalledTimes(2);
    expect(notifications.notify.mock.calls[0][0]).toMatchObject({ type: 'client.salon_new_flash', data: { salonId: 'salon-1' }, dedupeKey: 'fav-flash:salon-1:2026-11-10' });
  });

  it('ne prévient personne pour un profil masqué, et ne lève jamais d’erreur', async () => {
    const notifications: any = { notify: jest.fn() };
    await notifyFavoritesOfNewWork({ user: { findUnique: jest.fn().mockResolvedValue({ publicVisibility: 'HIDDEN' }) } } as any, notifications, 's', 'portfolio');
    await expect(notifyFavoritesOfNewWork({ user: { findUnique: jest.fn().mockRejectedValue(new Error('db')) } } as any, notifications, 's', 'portfolio')).resolves.toBeUndefined();
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});
