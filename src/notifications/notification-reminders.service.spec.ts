import { NotificationRemindersService } from './notification-reminders.service';

function build(overrides: Record<string, unknown> = {}) {
  const empty = jest.fn().mockResolvedValue([]);
  const prisma: any = {
    appointment: { findMany: empty, groupBy: empty },
    messageNotification: { findMany: empty },
    stockItem: { findMany: empty },
    user: { findMany: empty },
    salonReview: { groupBy: empty },
    ...overrides,
  };
  const notifications: any = { notify: jest.fn().mockResolvedValue(null), purgeOlderThan: jest.fn().mockResolvedValue(0) };
  return { svc: new NotificationRemindersService(prisma, notifications), prisma, notifications };
}

describe('NotificationRemindersService', () => {
  it('rappelle le salon et l’artiste un rendez-vous qui commence dans l’heure, avec une clé anti-doublon', async () => {
    const start = new Date('2026-11-10T13:30:00Z');
    const findMany = jest.fn().mockImplementation(async (args: any) =>
      args.where.status === 'CONFIRMED' && args.where.start?.lte
        ? [{ id: 'a1', userId: 'salon', performerUserId: 'artist', start, title: 'Bras', client: { firstName: 'Léa', lastName: 'M' } }]
        : [],
    );
    const { svc, notifications } = build({ appointment: { findMany, groupBy: jest.fn().mockResolvedValue([]) } });
    await svc.run(new Date('2026-11-10T13:00:00Z'));
    const calls = notifications.notify.mock.calls.map((c: any[]) => c[0]).filter((n: any) => n.type === 'appointment.reminder');
    expect(calls.map((n: any) => n.userId).sort()).toEqual(['artist', 'salon']);
    expect(calls[0].dedupeKey).toBe('reminder:a1');
    expect(calls[0].title).toBe('Rendez-vous à 14h30');
  });

  it('continue les autres rappels quand l’un échoue', async () => {
    const { svc, notifications } = build({ appointment: { findMany: jest.fn().mockRejectedValue(new Error('db')), groupBy: jest.fn().mockResolvedValue([]) } });
    await expect(svc.run(new Date('2026-11-10T09:00:00Z'))).resolves.toBeUndefined();
    expect(notifications.purgeOlderThan).toHaveBeenCalledWith(90);
  });
});
