import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { WorkFavoritesService } from './work-favorites.service';

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('WorkFavoritesService', () => {
  let prisma: any;
  let notifications: any;
  let service: WorkFavoritesService;

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ role: 'client', nickname: null, clientProfile: { pseudo: 'inkfan' } }) },
      professionalBlock: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
      flash: { findUnique: jest.fn().mockResolvedValue({ id: 'f1', userId: 'pro', title: 'Rose', user: { publicVisibility: 'VISIBLE' } }) },
      favoriteFlash: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        delete: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      favoritePortfolio: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      conversation: { findMany: jest.fn().mockResolvedValue([]) },
    };
    notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    service = new WorkFavoritesService(prisma, notifications);
  });

  it('toggles a flash favorite and tells the pro with the pseudo only', async () => {
    await expect(service.toggleFlash('client', 'client', 'f1')).resolves.toMatchObject({ favorite: true });
    await flush();
    const notification = notifications.notify.mock.calls[0][0];
    expect(notification).toMatchObject({ userId: 'pro', type: 'favorite.work_added', dedupeKey: 'favorite:flash:f1:client' });
    expect(notification.title).toBe("inkfan a mis en favori l'un de vos flashs");
    expect(notification.data).toEqual({ clientUserId: 'client', kind: 'flash', flashId: 'f1' });

    prisma.favoriteFlash.findUnique.mockResolvedValue({ id: 'fav' });
    await expect(service.toggleFlash('client', 'client', 'f1')).resolves.toMatchObject({ favorite: false });
    expect(prisma.favoriteFlash.delete).toHaveBeenCalledWith({ where: { id: 'fav' } });
  });

  it('refuses pros and hidden profiles', async () => {
    await expect(service.toggleFlash('pro2', 'user_salon', 'f1')).rejects.toBeInstanceOf(ForbiddenException);
    prisma.flash.findUnique.mockResolvedValue({ id: 'f1', userId: 'pro', title: 'Rose', user: { publicVisibility: 'HIDDEN' } });
    await expect(service.toggleFlash('client', 'client', 'f1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not notify a pro blocked by the client', async () => {
    prisma.professionalBlock.findUnique.mockResolvedValue({ id: 'block' });
    service.notifyFavorited('client', 'portfolio', { id: 'p1', userId: 'pro', title: 'Lion' });
    await flush();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('lists received favorites newest first with the pseudo and the existing conversation', async () => {
    prisma.favoritePortfolio.findMany.mockResolvedValue([
      { id: 'fp', createdAt: new Date('2026-11-01'), client: { id: 'c1', nickname: null, clientProfile: { pseudo: 'inkfan' } }, portfolio: { id: 'p1', title: 'Lion', imageUrl: 'u', tatoueur: null } },
    ]);
    prisma.favoriteFlash.findMany.mockResolvedValue([
      { id: 'ff', createdAt: new Date('2026-11-02'), client: { id: 'c2', nickname: 'nick', clientProfile: null }, flash: { id: 'f1', title: 'Rose', imageUrl: 'u', price: 80, tatoueur: { id: 't', name: 'Alex' } } },
    ]);
    prisma.favoritePortfolio.count.mockResolvedValue(1);
    prisma.favoriteFlash.count.mockResolvedValue(1);
    prisma.conversation.findMany.mockResolvedValue([{ id: 'conv', clientUserId: 'c1', clientAccess: 'HIDDEN' }]);
    prisma.professionalBlock.findMany.mockResolvedValue([{ clientUserId: 'c2' }]);

    const result = await service.received('pro', 'user_salon');
    expect(result.total).toBe(2);
    expect(result.data.map((d) => d.kind)).toEqual(['flash', 'portfolio']);
    expect(result.data[0]).toMatchObject({ clientPseudo: 'nick', canContact: false, conversation: null });
    expect(result.data[1]).toMatchObject({ clientPseudo: 'inkfan', canContact: true, conversation: { id: 'conv', clientAccess: 'HIDDEN' } });
    // Le client n'est lu que par son pseudo.
    expect(prisma.favoritePortfolio.findMany.mock.calls[0][0].select.client).toEqual({
      select: { id: true, nickname: true, clientProfile: { select: { pseudo: true } } },
    });
    await expect(service.received('client', 'client')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
