import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ChannelConnectionStatus, ChannelProvider, ExternalMessageDirection, InboxChannel, Role } from '@prisma/client';
import { InstagramService } from './instagram.service';
import { encryptInstagramToken } from './instagram-security';

describe('InstagramService', () => {
  const original = { ...process.env };
  let prisma: any;
  let api: any;
  let gateway: any;
  let service: InstagramService;
  const ownerId = 'salon-A';
  const connection = {
    id: 'conn-A', provider: ChannelProvider.INSTAGRAM, ownerUserId: ownerId,
    providerAccountId: 'business-A', providerUserId: 'alt-A',
    status: ChannelConnectionStatus.ACTIVE, accessTokenEncrypted: '', tokenExpiresAt: new Date(Date.now() + 20 * 86400_000),
  };

  beforeEach(() => {
    process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY = 'b'.repeat(64);
    process.env.INSTAGRAM_APP_ID = 'id-test';
    process.env.INSTAGRAM_APP_SECRET = 'secret-test';
    process.env.INSTAGRAM_OAUTH_STATE_SECRET = 'oauth-secret-test';
    process.env.INSTAGRAM_OAUTH_REDIRECT_URI = 'https://api.example.test/messaging/instagram/callback';
    process.env.INSTAGRAM_STUDIO_RETURN_URL = 'https://studio.example.test/messagerie';
    connection.accessTokenEncrypted = encryptInstagramToken('token-test');
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ role: Role.user_salon }) },
      channelConnection: {
        findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), upsert: jest.fn(), update: jest.fn(),
      },
      externalConversation: { findUnique: jest.fn(), update: jest.fn() },
      externalMessage: { findFirst: jest.fn(), create: jest.fn() },
      inboxThread: { update: jest.fn() }, inboxReadState: { upsert: jest.fn() },
      $transaction: jest.fn(),
    };
    api = {
      buildAuthorizationUrl: jest.fn().mockReturnValue('https://www.instagram.com/oauth/authorize'),
      exchangeCode: jest.fn().mockResolvedValue({ access_token: 'court', user_id: 'alt-A' }),
      exchangeLongLivedToken: jest.fn().mockResolvedValue({ access_token: 'long', expires_in: 500000 }),
      profile: jest.fn().mockResolvedValue({ id: 'business-A', user_id: 'alt-A', username: 'inkera' }),
      subscribeMessages: jest.fn().mockResolvedValue(undefined), sendMessage: jest.fn().mockResolvedValue('mid-123'),
      contactProfile: jest.fn().mockResolvedValue({ username: 'client_ig' }),
      refreshToken: jest.fn(),
    };
    gateway = { notifyUser: jest.fn() };
    service = new InstagramService(prisma, api, gateway);
  });
  afterEach(() => { process.env = { ...original }; jest.restoreAllMocks(); });

  it('empêche les comptes clients de lancer une connexion OAuth', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: Role.client });
    await expect(service.authorization('client')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('empêche de voler une connexion appartenant à un autre salon', async () => {
    prisma.channelConnection.findUnique.mockResolvedValue({ ...connection, ownerUserId: 'salon-B' });
    await expect(service.callback('code-test', require('./instagram-security').createInstagramState(ownerId)))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.channelConnection.upsert).not.toHaveBeenCalled();
  });

  it('conserve l’historique lors de la déconnexion', async () => {
    prisma.channelConnection.findFirst.mockResolvedValue(connection);
    prisma.channelConnection.update.mockResolvedValue({});
    await expect(service.disconnect(ownerId, connection.id)).resolves.toEqual({ disconnected: true });
    expect(prisma.channelConnection.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: ChannelConnectionStatus.DISCONNECTED, accessTokenEncrypted: null }),
    }));
  });

  it('refuse de répondre si le client n’a pas écrit depuis 24 heures', async () => {
    prisma.externalConversation.findUnique.mockResolvedValue({
      id: 'conv', connection, contact: { providerContactId: 'client-ig' },
    });
    prisma.externalMessage.findFirst.mockResolvedValue({ providerCreatedAt: new Date(Date.now() - 25 * 3600_000) });
    await expect(service.sendReply(ownerId, {
      id: 'thread', channel: InboxChannel.INSTAGRAM, ownerUserId: ownerId,
      externalConversationId: 'conv', assignedUserId: null,
    }, { content: 'Bonjour' })).rejects.toBeInstanceOf(BadRequestException);
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it('envoie un DM autorisé et le persiste sans toucher aux messages Inkera', async () => {
    prisma.externalConversation.findUnique.mockResolvedValue({
      id: 'conv', connection, contact: { providerContactId: 'client-ig' },
    });
    prisma.externalMessage.findFirst.mockResolvedValue({ providerCreatedAt: new Date() });
    prisma.externalMessage.create.mockResolvedValue({ id: 'message-test' });
    prisma.externalConversation.update.mockResolvedValue({});
    prisma.inboxThread.update.mockResolvedValue({});
    prisma.inboxReadState.upsert.mockResolvedValue({});
    const result = await service.sendReply(ownerId, {
      id: 'thread', channel: InboxChannel.INSTAGRAM, ownerUserId: ownerId,
      externalConversationId: 'conv', assignedUserId: null,
    }, { content: 'Bonjour' });
    expect(result).toEqual({ id: 'message-test' });
    expect(api.sendMessage).toHaveBeenCalledWith('business-A', 'client-ig', 'token-test', { text: 'Bonjour' });
    expect(prisma.externalMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ direction: ExternalMessageDirection.OUTBOUND, providerMessageId: 'mid-123' }),
    }));
    expect(gateway.notifyUser).toHaveBeenCalledWith(ownerId, 'inbox-message-updated', { threadId: 'thread' });
  });

  it('ignore les Webhooks rejoués et marque les vrais nouveaux messages comme non lus', async () => {
    prisma.channelConnection.findFirst.mockResolvedValue(connection);
    const tx = {
      externalContact: { upsert: jest.fn().mockResolvedValue({ id: 'contact' }) },
      externalConversation: { upsert: jest.fn().mockResolvedValue({ id: 'conv' }), updateMany: jest.fn() },
      inboxThread: { upsert: jest.fn().mockResolvedValue({ id: 'thread', ownerUserId: ownerId, assignedUserId: 'tatoueur' }), updateMany: jest.fn() },
      externalMessage: { create: jest.fn() }, inboxReadState: { upsert: jest.fn() },
    };
    prisma.$transaction.mockImplementation(async (cb: (transaction: typeof tx) => Promise<unknown>) => cb(tx));
    const webhook = { object: 'instagram', entry: [{ id: 'business-A', messaging: [{
      sender: { id: 'client-ig' }, recipient: { id: 'business-A' },
      message: { mid: 'msg-incoming', text: 'Bonjour' }, timestamp: Date.now(),
    }] }] };
    await service.handleWebhook(webhook);
    expect(tx.inboxReadState.upsert).toHaveBeenCalledTimes(2);
    expect(tx.externalMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ direction: ExternalMessageDirection.INBOUND, providerMessageId: 'msg-incoming' }),
    }));
    expect(gateway.notifyUser).toHaveBeenCalledWith('tatoueur', 'inbox-message-updated', { threadId: 'thread' });
    tx.externalMessage.create.mockRejectedValueOnce({ code: 'P2002' });
    await expect(service.handleWebhook(webhook)).resolves.toBeUndefined();
  });
});
