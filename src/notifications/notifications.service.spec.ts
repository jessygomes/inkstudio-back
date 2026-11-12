import { Prisma } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { categoriesForRole, NOTIFICATION_TYPES } from './notification-catalog';

function setup(pref: { inApp: boolean; push: boolean } | null = null) {
  const created = { id: 'n1', userId: 'u1', type: 'stock.low', category: 'stock', title: 't', body: 'b', data: null, readAt: null, createdAt: new Date() };
  const prisma: any = {
    appNotification: {
      create: jest.fn().mockResolvedValue(created),
      count: jest.fn().mockResolvedValue(3),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn(),
    },
    notificationCategoryPreference: {
      findUnique: jest.fn().mockResolvedValue(pref),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ role: 'user_salon' }) },
  };
  const svc = new NotificationsService(prisma);
  const emitter = jest.fn();
  svc.registerEmitter(emitter);
  return { svc, prisma, emitter };
}

describe('NotificationsService', () => {
  it('crée la notification et prévient l’utilisateur en temps réel', async () => {
    const { svc, prisma, emitter } = setup();
    const n = await svc.notify({ userId: 'u1', type: 'stock.low', title: 't', body: 'b' });
    expect(n?.id).toBe('n1');
    expect(prisma.appNotification.create.mock.calls[0][0].data.category).toBe('stock');
    await new Promise((r) => setImmediate(r));
    expect(emitter).toHaveBeenCalledWith('u1', 'notification-created', expect.objectContaining({ id: 'n1' }));
    expect(emitter).toHaveBeenCalledWith('u1', 'notification-unread-count', { unreadCount: 3 });
  });

  it('ignore une catégorie désactivée', async () => {
    const { svc, prisma } = setup({ inApp: false, push: true });
    expect(await svc.notify({ userId: 'u1', type: 'stock.low', title: 't', body: 'b' })).toBeNull();
    expect(prisma.appNotification.create).not.toHaveBeenCalled();
  });

  it('ne permet pas de couper une notification critique', async () => {
    const { svc, prisma } = setup({ inApp: false, push: false });
    await svc.notify({ userId: 'u1', type: 'account.payment_failed', title: 't', body: 'b' });
    expect(prisma.appNotification.create).toHaveBeenCalled();
  });

  it('ignore un doublon (clé de déduplication) sans erreur', async () => {
    const { svc, prisma } = setup();
    prisma.appNotification.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }));
    expect(await svc.notify({ userId: 'u1', type: 'stock.low', title: 't', body: 'b', dedupeKey: 'k' })).toBeNull();
  });

  it('ne lève jamais d’erreur si la base échoue', async () => {
    const { svc, prisma } = setup();
    prisma.appNotification.create.mockRejectedValue(new Error('db'));
    await expect(svc.notify({ userId: 'u1', type: 'stock.low', title: 't', body: 'b' })).resolves.toBeNull();
  });

  it('ne marque lue que la notification de l’utilisateur', async () => {
    const { svc, prisma } = setup();
    await svc.markRead('u1', 'n1');
    expect(prisma.appNotification.updateMany.mock.calls[0][0].where).toEqual({ id: 'n1', userId: 'u1', readAt: null });
  });

  it('propose les catégories selon le rôle', () => {
    expect(categoriesForRole('client')).toEqual(expect.arrayContaining(['aftercare', 'salons']));
    expect(categoriesForRole('client')).not.toContain('stock');
    expect(categoriesForRole('user_salon')).toEqual(expect.arrayContaining(['stock', 'team', 'account']));
    expect(categoriesForRole('user_salon')).not.toContain('aftercare');
  });

  it('chaque type a une catégorie connue', () => {
    expect(Object.keys(NOTIFICATION_TYPES).length).toBeGreaterThan(40);
  });
});

describe('NotificationsService : push', () => {
  function withPush(pref: { inApp: boolean; push: boolean } | null = null) {
    const ctx = setup(pref);
    const push = { send: jest.fn().mockResolvedValue(undefined) };
    const svc = new NotificationsService(ctx.prisma, push as never);
    svc.registerEmitter(ctx.emitter);
    return { ...ctx, svc, push };
  }

  it('envoie aussi la notification en push, avec de quoi ouvrir le bon écran', async () => {
    const { svc, push } = withPush();
    await svc.notify({ userId: 'u1', type: 'stock.low', title: 'Stock bas', body: 'Encre noire', data: { stockItemId: 's1' } });
    expect(push.send).toHaveBeenCalledWith('u1', { title: 't', body: 'b', data: expect.objectContaining({ notificationId: 'n1', type: 'stock.low', category: 'stock' }) });
  });

  it('n’envoie pas de push si la catégorie est coupée pour le push, mais garde la notification dans l’app', async () => {
    const { svc, prisma, push } = withPush({ inApp: true, push: false });
    expect(await svc.notify({ userId: 'u1', type: 'stock.low', title: 't', body: 'b' })).not.toBeNull();
    expect(prisma.appNotification.create).toHaveBeenCalled();
    expect(push.send).not.toHaveBeenCalled();
  });

  it('push seul quand la catégorie est coupée dans l’app mais pas pour le push (pas d’entrée dans le centre)', async () => {
    const { svc, prisma, push } = withPush({ inApp: false, push: true });
    expect(await svc.notify({ userId: 'u1', type: 'stock.low', title: 'Stock bas', body: 'x', data: { stockItemId: 's1' } })).toBeNull();
    expect(prisma.appNotification.create).not.toHaveBeenCalled();
    expect(push.send).toHaveBeenCalledWith('u1', expect.objectContaining({ title: 'Stock bas', data: expect.objectContaining({ stockItemId: 's1', type: 'stock.low', category: 'stock' }) }));
  });

  it('rien du tout quand les deux canaux sont coupés', async () => {
    const { svc, prisma, push } = withPush({ inApp: false, push: false });
    expect(await svc.notify({ userId: 'u1', type: 'stock.low', title: 't', body: 'b' })).toBeNull();
    expect(prisma.appNotification.create).not.toHaveBeenCalled();
    expect(push.send).not.toHaveBeenCalled();
  });

  it('une notification critique part toujours en push', async () => {
    const { svc, push } = withPush({ inApp: false, push: false });
    await svc.notify({ userId: 'u1', type: 'account.payment_failed', title: 't', body: 'b' });
    expect(push.send).toHaveBeenCalledTimes(1);
  });
});
