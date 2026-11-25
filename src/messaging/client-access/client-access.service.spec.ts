import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ClientAccessService } from './client-access.service';
import { isClientIdentityHidden, maskClientUser, maskConversationClient } from '../client-identity';

describe('Client identity masking', () => {
  it('hides the client while access is not granted', () => {
    expect(isClientIdentityHidden({ clientAccess: null })).toBe(false);
    expect(isClientIdentityHidden({ clientAccess: 'GRANTED' })).toBe(false);
    for (const state of ['HIDDEN', 'REQUESTED', 'DECLINED']) expect(isClientIdentityHidden({ clientAccess: state })).toBe(true);
  });

  it('replaces every personal field with the pseudo', () => {
    const masked = maskClientUser({ id: 'c', firstName: 'Benoît', lastName: 'Martin', email: 'b@x.fr', image: 'img', phone: '06' }, 'inkfan');
    expect(masked).toEqual({ id: 'c', firstName: 'inkfan', lastName: null, email: '', image: null, phone: null });
    const conversation = maskConversationClient({ clientAccess: 'HIDDEN', clientAlias: 'inkfan', clientUser: { id: 'c', firstName: 'Benoît', email: 'b@x.fr' } });
    expect(conversation.clientUser).toEqual({ id: 'c', firstName: 'inkfan', lastName: null, email: '' });
    const open = { clientAccess: 'GRANTED', clientAlias: 'inkfan', clientUser: { id: 'c', firstName: 'Benoît' } };
    expect(maskConversationClient(open)).toBe(open);
  });
});

describe('ClientAccessService', () => {
  let prisma: any;
  let unread: any;
  let notifications: any;
  let service: ClientAccessService;

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      favoritePortfolio: { count: jest.fn().mockResolvedValue(1) },
      favoriteFlash: { count: jest.fn().mockResolvedValue(0) },
      conversation: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'conv', lastMessageAt: new Date() }),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      inboxThread: { create: jest.fn(), updateMany: jest.fn() },
      professionalBlock: { findUnique: jest.fn().mockResolvedValue(null) },
      message: { create: jest.fn().mockResolvedValue({ id: 'msg', sender: { id: 'x' }, attachments: [] }) },
      client: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({ id: 'fiche' }), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $queryRaw: jest.fn(),
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((callback: any) => callback(prisma));
    prisma.user.findUnique.mockImplementation(({ where, select }: any) => {
      if (where.id === 'pro') {
        // Compte pro, plan actif
        return Promise.resolve({ id: 'pro', role: 'user_salon', salonName: 'Ink Studio', firstName: null, lastName: null, saasPlan: 'PRO', saasPlanUntil: null, saasPlanDetails: null });
      }
      if (select?.clientProfile && select?.email) {
        return Promise.resolve({ firstName: 'Benoît', lastName: 'Martin', email: 'b@x.fr', phone: '0600', clientProfile: { birthDate: null, pseudo: 'inkfan' } });
      }
      return Promise.resolve({ id: 'client', role: 'client', nickname: null, clientProfile: { pseudo: 'inkfan' }, firstName: 'Benoît', lastName: 'Martin' });
    });
    unread = { incrementUnreadCount: jest.fn(), getTotalUnreadCount: jest.fn().mockResolvedValue(1) };
    notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    service = new ClientAccessService(prisma, unread, notifications);
  });

  it('opens a hidden conversation only for a client who favorited one of the pro works', async () => {
    await expect(service.startFromFavorite('pro', 'client')).resolves.toMatchObject({ conversationId: 'conv', created: true, knownClient: false });
    expect(prisma.conversation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ salonId: 'pro', clientUserId: 'client', clientAccess: 'HIDDEN', clientAlias: 'inkfan' }),
    }));
    prisma.favoritePortfolio.count.mockResolvedValue(0);
    prisma.conversation.create.mockClear();
    await expect(service.startFromFavorite('pro', 'client')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.conversation.create).not.toHaveBeenCalled();
  });

  it('opens a normal conversation, linked to the record, for a client already in the pro records', async () => {
    prisma.client.findMany.mockResolvedValueOnce([{ id: 'fiche-connue', firstName: 'Benoît', lastName: 'Martin', email: 'b@x.fr', linkedUserId: 'client' }]);
    await expect(service.startFromFavorite('pro', 'client')).resolves.toMatchObject({ conversationId: 'conv', created: true, knownClient: true });
    expect(prisma.conversation.create.mock.calls[0][0].data.clientAccess).toBeNull();
    expect(prisma.inboxThread.create.mock.calls[0][0].data.linkedClientId).toBe('fiche-connue');
  });

  it('recognizes an unlinked record with the verified account e-mail', async () => {
    prisma.client.findMany
      .mockResolvedValueOnce([]) // fiche reliée
      .mockResolvedValueOnce([{ id: 'fiche-mail', firstName: 'Benoît', lastName: 'Martin', email: 'B@X.fr ', linkedUserId: null }]);
    prisma.user.findMany.mockResolvedValue([{ id: 'client', email: 'b@x.fr' }]);
    await expect(service.startFromFavorite('pro', 'client')).resolves.toMatchObject({ knownClient: true });
    expect(prisma.user.findMany.mock.calls[0][0].where).toMatchObject({ emailVerified: { not: null } });
  });

  it('turns an existing hidden conversation back to normal once the client is known', async () => {
    prisma.conversation.findFirst.mockResolvedValue({ id: 'old', status: 'ACTIVE', clientAccess: 'HIDDEN' });
    prisma.client.findMany.mockResolvedValueOnce([{ id: 'fiche-connue', firstName: 'B', lastName: 'M', email: 'b@x.fr', linkedUserId: 'client' }]);
    await expect(service.startFromFavorite('pro', 'client')).resolves.toMatchObject({ conversationId: 'old', knownClient: true });
    expect(prisma.conversation.updateMany).toHaveBeenCalledWith({ where: { id: 'old', clientAccess: 'HIDDEN' }, data: { clientAccess: null, clientAccessRespondedAt: null } });
    expect(prisma.inboxThread.updateMany).toHaveBeenCalledWith({ where: { conversationId: 'old', linkedClientId: null }, data: { linkedClientId: 'fiche-connue' } });
  });

  it('reuses an existing conversation without changing its access', async () => {
    prisma.conversation.findFirst.mockResolvedValue({ id: 'old', status: 'ACTIVE' });
    await expect(service.startFromFavorite('pro', 'client')).resolves.toMatchObject({ conversationId: 'old', created: false, knownClient: false });
    expect(prisma.conversation.create).not.toHaveBeenCalled();
  });

  it('does not contact a client who blocked the pro', async () => {
    prisma.professionalBlock.findUnique.mockResolvedValue({ id: 'block' });
    await expect(service.startFromFavorite('pro', 'client')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('sends an access request once, from the owning pro only', async () => {
    prisma.conversation.findUnique.mockResolvedValue({ id: 'conv', salonId: 'pro', clientUserId: 'client', clientAccess: 'HIDDEN' });
    await expect(service.requestAccess('pro', 'conv')).resolves.toMatchObject({ clientAccess: 'REQUESTED' });
    expect(prisma.message.create.mock.calls[0][0].data.type).toBe('ACCESS_REQUEST');
    expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 'client', type: 'client.access_request' }));

    prisma.conversation.findUnique.mockResolvedValue({ id: 'conv', salonId: 'pro', clientUserId: 'client', clientAccess: 'REQUESTED' });
    await expect(service.requestAccess('pro', 'conv')).rejects.toBeInstanceOf(ConflictException);
    prisma.conversation.findUnique.mockResolvedValue({ id: 'conv', salonId: 'pro', clientUserId: 'client', clientAccess: null });
    await expect(service.requestAccess('pro', 'conv')).rejects.toBeInstanceOf(ConflictException);
    prisma.conversation.findUnique.mockResolvedValue({ id: 'conv', salonId: 'other', clientUserId: 'client', clientAccess: 'HIDDEN' });
    await expect(service.requestAccess('pro', 'conv')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('waits 7 days before asking again after a refusal', async () => {
    prisma.conversation.findUnique.mockResolvedValue({
      id: 'conv', salonId: 'pro', clientUserId: 'client', clientAccess: 'DECLINED', clientAccessRespondedAt: new Date(),
    });
    await expect(service.requestAccess('pro', 'conv')).rejects.toBeInstanceOf(ConflictException);
    prisma.conversation.findUnique.mockResolvedValue({
      id: 'conv', salonId: 'pro', clientUserId: 'client', clientAccess: 'DECLINED', clientAccessRespondedAt: new Date(Date.now() - 8 * 86_400_000),
    });
    await expect(service.requestAccess('pro', 'conv')).resolves.toMatchObject({ clientAccess: 'REQUESTED' });
  });

  it('on acceptance, creates a client record linked to the account and the thread', async () => {
    prisma.conversation.findUnique.mockResolvedValue({ id: 'conv', salonId: 'pro', clientUserId: 'client', clientAccess: 'REQUESTED', clientAlias: 'inkfan' });
    await expect(service.respond('client', 'conv', true)).resolves.toEqual({ clientAccess: 'GRANTED', clientId: 'fiche' });
    expect(prisma.client.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'pro', firstName: 'Benoît', lastName: 'Martin', email: 'b@x.fr', linkedUserId: 'client' }),
    }));
    expect(prisma.inboxThread.updateMany).toHaveBeenCalledWith({ where: { conversationId: 'conv', linkedClientId: null }, data: { linkedClientId: 'fiche' } });
    expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 'pro', type: 'contact.access_reply' }));
  });

  it('on refusal, shares nothing and keeps the pseudo', async () => {
    prisma.conversation.findUnique.mockResolvedValue({ id: 'conv', salonId: 'pro', clientUserId: 'client', clientAccess: 'REQUESTED', clientAlias: 'inkfan' });
    await expect(service.respond('client', 'conv', false)).resolves.toEqual({ clientAccess: 'DECLINED', clientId: null });
    expect(prisma.client.create).not.toHaveBeenCalled();
    const notification = notifications.notify.mock.calls[0][0];
    expect(notification.title).toContain('inkfan');
    expect(notification.title).not.toContain('Benoît');
  });

  it('only the client of the conversation can answer a pending request', async () => {
    prisma.conversation.findUnique.mockResolvedValue({ id: 'conv', salonId: 'pro', clientUserId: 'client', clientAccess: 'REQUESTED' });
    await expect(service.respond('someone', 'conv', true)).rejects.toBeInstanceOf(ForbiddenException);
    prisma.conversation.findUnique.mockResolvedValue({ id: 'conv', salonId: 'pro', clientUserId: 'client', clientAccess: 'HIDDEN' });
    await expect(service.respond('client', 'conv', true)).rejects.toBeInstanceOf(ConflictException);
  });
});
