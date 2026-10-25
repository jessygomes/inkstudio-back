import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InboxChannel, InboxThreadStatus, MessageType } from '@prisma/client';
import { InboxService } from './inbox.service';
import { PrismaService } from '../../database/prisma.service';
import { MessageNotificationService } from '../notifications/message-notification.service';
import { MessagesGateway } from '../websocket/messages.gateway';

const salon = { id: 'salon-a', role: 'user_salon', salonId: null };
const artist = { id: 'artist-a', role: 'user_tatoueur', salonId: 'salon-a' };
const secondArtist = { id: 'artist-b', role: 'user_tatoueur', salonId: 'salon-a' };
const thread = {
  id: 'thread-a', ownerUserId: 'salon-a', channel: InboxChannel.INKERA,
  conversationId: 'conversation-a', externalConversationId: null,
  assignedUserId: 'artist-a', assignedTatoueurId: null, linkedClientId: null,
  status: InboxThreadStatus.NEW, lastMessageAt: new Date('2026-10-22'),
  conversation: { id: 'conversation-a', salonId: 'salon-a', clientUserId: 'client-inkera', messages: [] },
};

function createMock() {
  return {
    professionalBlock: { findUnique: jest.fn().mockResolvedValue(null) },
    user: { findUnique: jest.fn() },
    inboxThread: { findMany: jest.fn(), findUnique: jest.fn(), count: jest.fn(), update: jest.fn() },
    inboxMemberPermission: { findUnique: jest.fn(), upsert: jest.fn() },
    tatoueur: { findUnique: jest.fn() },
    client: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    appointment: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    inboxThreadAppointment: { upsert: jest.fn() },
    inboxInternalNote: { create: jest.fn(), findMany: jest.fn() },
    inboxReadState: { upsert: jest.fn(), findMany: jest.fn() },
    messageNotification: { findMany: jest.fn() },
    savedReply: { findMany: jest.fn(), create: jest.fn() },
    message: { create: jest.fn(), findMany: jest.fn(), count: jest.fn(), updateMany: jest.fn() },
    externalMessage: { findMany: jest.fn(), count: jest.fn() },
    conversation: { update: jest.fn() },
  };
}

describe('InboxService: droits, fonctionnalités et non-régression', () => {
  let prisma: ReturnType<typeof createMock>;
  let notification: { incrementUnreadCount: jest.Mock; resetUnreadCount: jest.Mock; getTotalUnreadCount: jest.Mock };
  let service: InboxService;

  beforeEach(() => {
    prisma = createMock();
    notification = {
      incrementUnreadCount: jest.fn().mockResolvedValue(undefined),
      resetUnreadCount: jest.fn().mockResolvedValue(undefined),
      getTotalUnreadCount: jest.fn().mockResolvedValue(0),
    };
    service = new InboxService(prisma as unknown as PrismaService, notification as unknown as MessageNotificationService);
    prisma.user.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.id === 'salon-a') return salon;
      if (where.id === 'artist-a') return artist;
      if (where.id === 'artist-b') return secondArtist;
      return null;
    });
    prisma.inboxThread.findUnique.mockResolvedValue(thread);
    prisma.inboxMemberPermission.findUnique.mockResolvedValue({ canView: true, canReply: true, canAssign: false });
    prisma.inboxThread.findMany.mockResolvedValue([thread]);
    prisma.inboxThread.count.mockResolvedValue(1);
    prisma.inboxReadState.findMany.mockResolvedValue([]);
    prisma.messageNotification.findMany.mockResolvedValue([]);
    prisma.inboxThread.update.mockImplementation(async ({ data }: any) => ({ ...thread, ...data }));
  });

  it('liste les conversations du salon uniquement dans son espace SQL', async () => {
    await service.listThreads('salon-a', { channel: InboxChannel.INKERA, page: 1, limit: 20 });
    expect(prisma.inboxThread.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerUserId: 'salon-a', channel: InboxChannel.INKERA }),
    }));
  });

  it('filtre les tatoueurs internes aussi bien que les comptes indépendants liés', async () => {
    await service.listThreads('salon-a', { assignedTatoueurId: 'internal-a' });
    expect(prisma.inboxThread.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerUserId: 'salon-a', assignedTatoueurId: 'internal-a' }),
    }));
  });

  it('met en évidence les fils ayant des messages non lus pour le professionnel', async () => {
    prisma.messageNotification.findMany.mockResolvedValue([{ conversationId: 'conversation-a', unreadCount: 3 }]);
    const result = await service.listThreads('salon-a', {});
    expect(result.data[0]).toEqual(expect.objectContaining({ unreadCount: 3 }));
  });

  it('le filtre non lus considère les notifications réelles et les marquages manuels', async () => {
    await service.listThreads('salon-a', { unreadOnly: true, search: 'Camille' });
    const options = prisma.inboxThread.findMany.mock.calls[0][0];
    expect(options.where.AND).toEqual(expect.arrayContaining([
      expect.objectContaining({ OR: expect.arrayContaining([
        expect.objectContaining({ conversation: expect.any(Object) }),
        expect.objectContaining({ readStates: expect.any(Object) }),
      ]) }),
    ]));
    expect(options.where.AND).toHaveLength(2);
  });

  it('marquer lu dans Inbox réinitialise aussi le compteur historique du salon', async () => {
    prisma.inboxReadState.upsert.mockResolvedValue({ forceUnread: false });
    await service.setReadState('salon-a', 'thread-a', false);
    expect(notification.resetUnreadCount).toHaveBeenCalledWith('conversation-a', 'salon-a');
  });

  it('dissocie la fiche CRM sans la supprimer', async () => {
    await service.unlinkClient('salon-a', 'thread-a');
    expect(prisma.inboxThread.update).toHaveBeenCalledWith({
      where: { id: 'thread-a' }, data: { linkedClientId: null },
    });
  });

  it('liste automatiquement les RDV du client de la conversation, par 5 et du plus récent au plus ancien', async () => {
    prisma.inboxThread.findUnique.mockResolvedValue({ ...thread, linkedClientId: 'client-a' });
    prisma.appointment.findMany.mockResolvedValue([{ id: 'rdv-new', title: 'Tattoo', start: new Date('2026-10-22') }]);
    prisma.appointment.count.mockResolvedValue(6);
    const result = await service.listAppointments('salon-a', 'thread-a', 1, 5);
    expect(prisma.appointment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 'salon-a' }),
      orderBy: [{ start: 'desc' }, { id: 'desc' }],
      take: 5, skip: 0,
    }));
    expect(result).toEqual(expect.objectContaining({ total: 6, totalPages: 2 }));
  });

  it('un indépendant liste ses conversations et celles du salon strictement assignées', async () => {
    await service.listThreads('artist-a', {});
    expect(prisma.inboxThread.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ OR: [
        { ownerUserId: 'artist-a' }, { ownerUserId: 'salon-a', assignedUserId: 'artist-a' },
      ] }),
    }));
  });

  it('interdit la lecture d’une conversation attribuée à un autre indépendant', async () => {
    await expect(service.getThread('artist-b', 'thread-a')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('interdit la lecture si canView a été révoqué', async () => {
    prisma.inboxMemberPermission.findUnique.mockResolvedValue({ canView: false, canReply: true });
    await expect(service.getThread('artist-a', 'thread-a')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('révoque l’accès si l’indépendant quitte le salon', async () => {
    prisma.user.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === 'artist-a' ? { ...artist, salonId: 'salon-b' } : salon,
    );
    await expect(service.getThread('artist-a', 'thread-a')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('sans autorisation du salon, la boîte personnelle de l’indépendant reste accessible', async () => {
    prisma.inboxMemberPermission.findUnique.mockResolvedValue(null);
    await service.listThreads('artist-a', {});
    expect(prisma.inboxThread.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerUserId: 'artist-a' }),
    }));
  });

  it('refuse l’accès à la nouvelle messagerie pour les comptes client', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'client', role: 'client', salonId: null });
    await expect(service.listThreads('client', {})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuse un salon tiers et un fil inexistant', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'salon-b', role: 'user_salon', salonId: null });
    await expect(service.getThread('salon-b', 'thread-a')).rejects.toBeInstanceOf(ForbiddenException);
    prisma.inboxThread.findUnique.mockResolvedValue(null);
    await expect(service.getThread('salon-b', 'missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('les informations de connexion externe ne renvoient jamais les jetons OAuth', async () => {
    await service.getThread('salon-a', 'thread-a');
    const options = prisma.inboxThread.findUnique.mock.calls[0][0];
    const fields = options.include.externalConversation.select.connection.select;
    expect(fields.provider).toBe(true);
    expect(fields.accessTokenEncrypted).toBeUndefined();
    expect(fields.refreshTokenEncrypted).toBeUndefined();
  });

  it('un salon peut attribuer à un indépendant lié; celui-ci ne peut pas réattribuer', async () => {
    await service.assignThread('salon-a', 'thread-a', { assignedUserId: 'artist-b' });
    expect(prisma.inboxThread.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ assignedUserId: 'artist-b', assignedTatoueurId: null, assignedByUserId: 'salon-a' }),
    }));
    await expect(service.assignThread('artist-a', 'thread-a', { assignedUserId: 'artist-b' }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuse une attribution à un tatoueur extérieur', async () => {
    prisma.user.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === 'artist-b' ? { ...secondArtist, salonId: 'salon-b' } : salon,
    );
    await expect(service.assignThread('salon-a', 'thread-a', { assignedUserId: 'artist-b' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuse l’attribution d’une conversation si le destinataire peut lire mais pas répondre', async () => {
    prisma.inboxMemberPermission.findUnique.mockResolvedValue({ canView: true, canReply: false });
    await expect(service.assignThread('salon-a', 'thread-a', { assignedUserId: 'artist-b' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('désattribue une conversation en vidant les deux affectations', async () => {
    await service.assignThread('salon-a', 'thread-a', {});
    expect(prisma.inboxThread.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ assignedUserId: null, assignedTatoueurId: null, assignedAt: null }),
    }));
  });

  it('peut attribuer au profil d’un tatoueur interne sans compte Inkera', async () => {
    prisma.tatoueur.findUnique.mockResolvedValue({ id: 'tatoueur-a', userId: 'salon-a' });
    await service.assignThread('salon-a', 'thread-a', { assignedTatoueurId: 'tatoueur-a' });
    expect(prisma.inboxThread.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ assignedUserId: null, assignedTatoueurId: 'tatoueur-a' }),
    }));
  });

  it('le salon configure les permissions; un indépendant ne le peut pas', async () => {
    await service.setMemberPermission('salon-a', 'artist-a', { canView: true, canReply: false, canAssign: false });
    expect(prisma.inboxMemberPermission.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { salonId_memberUserId: { salonId: 'salon-a', memberUserId: 'artist-a' } },
    }));
    await expect(service.setMemberPermission('artist-a', 'artist-b', { canView: true, canReply: true, canAssign: true }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('associe seulement une fiche client du salon', async () => {
    prisma.client.findUnique.mockResolvedValue({ id: 'crm-a', userId: 'salon-a' });
    await service.linkClient('salon-a', 'thread-a', 'crm-a');
    expect(prisma.inboxThread.update).toHaveBeenCalledWith(expect.objectContaining({ data: { linkedClientId: 'crm-a' } }));
    prisma.client.findUnique.mockResolvedValue({ id: 'crm-b', userId: 'salon-b' });
    await expect(service.linkClient('salon-a', 'thread-a', 'crm-b')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('ne lie pas une fiche CRM déjà attachée à un autre compte client Inkera', async () => {
    prisma.client.findUnique.mockResolvedValue({ id: 'crm-b', userId: 'salon-a', linkedUserId: 'client-other' });
    await expect(service.linkClient('salon-a', 'thread-a', 'crm-b')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('réutilise la fiche CRM existante au lieu de la dupliquer', async () => {
    prisma.client.findFirst.mockResolvedValue({ id: 'crm-a', userId: 'salon-a' });
    prisma.client.findUnique.mockResolvedValue({ id: 'crm-a', userId: 'salon-a' });
    await service.createAndLinkClient('salon-a', 'thread-a', {
      firstName: 'Léa', lastName: 'A', email: 'lea@example.fr', phone: '0102030405',
    });
    expect(prisma.client.create).not.toHaveBeenCalled();
    expect(prisma.inboxThread.update).toHaveBeenCalledWith(expect.objectContaining({ data: { linkedClientId: 'crm-a' } }));
  });

  it('lie plusieurs rendez-vous à la même conversation sans en créer une nouvelle', async () => {
    prisma.appointment.findUnique.mockResolvedValue({ id: 'appointment-2', userId: 'salon-a', clientUserId: 'client-inkera' });
    await service.linkAppointment('salon-a', 'thread-a', 'appointment-2');
    expect(prisma.inboxThreadAppointment.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { inboxThreadId_appointmentId: { inboxThreadId: 'thread-a', appointmentId: 'appointment-2' } },
    }));
  });

  it('refuse un rendez-vous appartenant à un autre salon', async () => {
    prisma.appointment.findUnique.mockResolvedValue({ id: 'appointment-b', userId: 'salon-b' });
    await expect(service.linkAppointment('salon-a', 'thread-a', 'appointment-b')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuse de rattacher le rendez-vous d’un autre client du même salon', async () => {
    prisma.appointment.findUnique.mockResolvedValue({ id: 'appointment-other', userId: 'salon-a', clientUserId: 'another-client' });
    await expect(service.linkAppointment('salon-a', 'thread-a', 'appointment-other'))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('un email et une conversation Inkera peuvent pointer vers une même fiche CRM sans fusionner leurs messages', async () => {
    prisma.inboxThread.findUnique.mockResolvedValue({
      ...thread, id: 'thread-email', channel: InboxChannel.EMAIL, conversationId: null,
      externalConversationId: 'email-conversation', linkedClientId: 'crm-a',
    });
    prisma.externalMessage.findMany.mockResolvedValue([{ id: 'external-message' }]);
    prisma.externalMessage.count.mockResolvedValue(1);
    const result = await service.getMessages('salon-a', 'thread-email');
    expect(result.data).toEqual([{ id: 'external-message' }]);
    expect(prisma.message.findMany).not.toHaveBeenCalled();
    expect(prisma.externalMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { externalConversationId: 'email-conversation' },
    }));
  });

  it('l’indépendant autorisé gère le statut et les notes de son fil assigné', async () => {
    await service.setStatus('artist-a', 'thread-a', InboxThreadStatus.IN_PROGRESS);
    await service.addNote('artist-a', 'thread-a', 'Appeler lundi');
    expect(prisma.inboxThread.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: InboxThreadStatus.IN_PROGRESS } }));
    expect(prisma.inboxInternalNote.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { inboxThreadId: 'thread-a', authorUserId: 'artist-a', content: 'Appeler lundi' },
    }));
  });

  it('un indépendant non assigné ne peut pas lire les notes internes', async () => {
    await expect(service.listNotes('artist-b', 'thread-a')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.inboxInternalNote.findMany).not.toHaveBeenCalled();
  });

  it('canView sans canReply ne permet pas de répondre', async () => {
    prisma.inboxMemberPermission.findUnique.mockResolvedValue({ canView: true, canReply: false });
    await expect(service.sendReply('artist-a', 'thread-a', { content: 'Bonjour' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('une réponse interne reste dans le fil d’origine et notifie le client', async () => {
    prisma.message.create.mockResolvedValue({ id: 'message-new', content: 'Bonjour', senderId: 'artist-a' });
    await service.sendReply('artist-a', 'thread-a', { content: 'Bonjour', attachments: [{
      fileName: 'image.png', fileUrl: 'https://example.com/image.png', fileType: 'image/png', fileSize: 1024,
    }] });
    expect(prisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ conversationId: 'conversation-a', senderId: 'artist-a', type: MessageType.TEXT }),
    }));
    expect(prisma.conversation.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'conversation-a' } }));
    expect(notification.incrementUnreadCount).toHaveBeenCalledWith('conversation-a', 'client-inkera');
  });

  it('la réponse envoyée depuis Inbox est diffusée en temps réel aux deux interlocuteurs', async () => {
    const gateway = { notifyConversation: jest.fn(), notifyUser: jest.fn() };
    const realtimeService = new InboxService(
      prisma as unknown as PrismaService,
      notification as unknown as MessageNotificationService,
      gateway as unknown as MessagesGateway,
    );
    const message = { id: 'message-live', conversationId: 'conversation-a', senderId: 'salon-a' };
    prisma.message.create.mockResolvedValue(message);
    await realtimeService.sendReply('salon-a', 'thread-a', { content: 'Bonjour' });
    expect(gateway.notifyConversation).toHaveBeenCalledWith('conversation-a', 'new-message', message);
    expect(gateway.notifyUser).toHaveBeenCalledWith('client-inkera', 'unread-count-updated', expect.objectContaining({ totalUnread: 0 }));
  });

  it('ne simule pas un envoi externe tant qu’aucun connecteur n’est activé', async () => {
    prisma.inboxThread.findUnique.mockResolvedValue({ ...thread, channel: InboxChannel.INSTAGRAM, conversationId: null });
    await expect(service.sendReply('salon-a', 'thread-a', { content: 'Bonjour' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('marquer non lu est propre à la personne connectée', async () => {
    await service.setReadState('artist-a', 'thread-a', true);
    expect(prisma.inboxReadState.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { inboxThreadId_userId: { inboxThreadId: 'thread-a', userId: 'artist-a' } },
      update: { forceUnread: true },
    }));
  });

  it('les réponses enregistrées sont propres à l’indépendant et à son salon lié', async () => {
    await service.listSavedReplies('artist-a');
    expect(prisma.savedReply.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerUserId: { in: ['artist-a', 'salon-a'] } }),
    }));
    await service.createSavedReply('artist-a', { title: 'Tarifs', content: 'À partir de...' });
    expect(prisma.savedReply.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ownerUserId: 'artist-a', createdByUserId: 'artist-a' }),
    }));
  });
});
