import { DrawingDeliveryService } from './drawing-delivery.service';

describe('Drawing version delivery', () => {
  let prisma: any;
  let mail: any;
  let service: DrawingDeliveryService;
  const card = {
    id: 'card',
    salonId: 'salon',
    performerUserId: 'artist',
    sourceAppointmentId: 'rdv',
    title: 'Fleurs',
    updatedAt: new Date('2026-10-28T12:00:00Z'),
    clientUserId: null,
    clientUser: null,
    client: {
      firstName: 'Alex',
      email: 'alex@example.com',
      linkedUserId: null,
    },
    salon: { salonName: 'Atelier', email: 'salon@example.com' },
  };
  const image = {
    id: 'image',
    cardId: 'card',
    version: 2,
    url: 'https://cdn.example.com/dessin.webp',
    clientEmailSentAt: null,
    clientMessageSentAt: null,
  };
  beforeEach(() => {
    prisma = {
      $queryRaw: jest.fn(),
      $transaction: jest.fn(),
      drawingCard: { findUnique: jest.fn().mockResolvedValue(card) },
      drawingCardImage: {
        findFirst: jest.fn().mockResolvedValue(image),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      conversation: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    prisma.$transaction.mockImplementation(async (callback) =>
      callback(prisma),
    );
    mail = { sendMail: jest.fn().mockResolvedValue({}) };
    service = new DrawingDeliveryService(
      prisma,
      mail,
      { notifyConversation: jest.fn(), notifyUser: jest.fn() } as any,
      { getTotalUnreadCount: jest.fn().mockResolvedValue(1) } as any,
    );
  });
  it('allows the assigned artist, sends the shared email and uses the salon reply-to', async () => {
    const result = await service.send('card', 'image', 'artist');
    expect(result).toMatchObject({
      emailSent: true,
      messageSent: false,
      conversationExists: false,
      emailError: null,
    });
    expect(mail.sendMail).toHaveBeenCalledWith(
      'alex@example.com',
      expect.any(String),
      expect.stringContaining('<img'),
      'Atelier',
      'salon@example.com',
    );
    expect(prisma.drawingCardImage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { clientEmailSentAt: expect.any(Date) },
      }),
    );
  });
  it('rejects strangers before any delivery', async () => {
    await expect(service.send('card', 'image', 'stranger')).rejects.toThrow(
      'Accès refusé',
    );
    expect(mail.sendMail).not.toHaveBeenCalled();
  });
  it('rejects images outside the card and concurrent sends', async () => {
    prisma.drawingCardImage.findFirst.mockResolvedValueOnce(null);
    await expect(service.send('card', 'other-image', 'salon')).rejects.toThrow(
      'Version introuvable',
    );
    prisma.drawingCardImage.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.send('card', 'image', 'salon')).rejects.toThrow(
      'déjà en cours',
    );
    expect(mail.sendMail).not.toHaveBeenCalled();
  });
  it('does not send an email twice', async () => {
    prisma.drawingCardImage.findFirst.mockResolvedValue({
      ...image,
      clientEmailSentAt: new Date(),
    });
    expect((await service.send('card', 'image', 'salon')).emailSent).toBe(true);
    expect(mail.sendMail).not.toHaveBeenCalled();
  });
  it('reports an email failure and releases the delivery lock', async () => {
    mail.sendMail.mockRejectedValue(new Error('mailgun unavailable'));
    expect(await service.send('card', 'image', 'salon')).toMatchObject({
      emailSent: false,
      emailError: expect.any(String),
    });
    expect(prisma.drawingCardImage.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { deliveryClaimedAt: null } }),
    );
  });
  it('delivers to the existing conversation atomically, even when email delivery fails', async () => {
    prisma.drawingCard.findUnique.mockResolvedValue({
      ...card,
      clientUserId: 'client',
    });
    const conversation = {
      id: 'conversation',
      salonId: 'salon',
      clientUserId: 'client',
    };
    prisma.conversation.findFirst.mockResolvedValue(conversation);
    prisma.user = {
      findUnique: jest.fn().mockResolvedValue({
        role: 'user',
        saasPlan: 'PRO',
        saasPlanUntil: null,
      }),
    };
    prisma.professionalBlock = {
      findUnique: jest.fn().mockResolvedValue(null),
    };
    const tx = {
      message: { create: jest.fn().mockResolvedValue({ id: 'message' }) },
      conversation: { update: jest.fn() },
      messageNotification: { upsert: jest.fn() },
      drawingCardImage: { update: jest.fn() },
    };
    prisma.$transaction = jest.fn((callback) =>
      callback({
        ...prisma,
        ...tx,
        drawingCardImage: {
          ...prisma.drawingCardImage,
          ...tx.drawingCardImage,
        },
      }),
    );
    mail.sendMail.mockRejectedValue(new Error('unavailable'));
    const result = await service.send('card', 'image', 'artist');
    expect(result).toMatchObject({
      emailSent: false,
      messageSent: true,
      conversationExists: true,
    });
    expect(tx.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          senderId: 'salon',
          attachments: expect.any(Object),
        }),
      }),
    );
    expect(tx.drawingCardImage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { clientMessageSentAt: expect.any(Date) },
      }),
    );
    expect(tx.messageNotification.upsert).toHaveBeenCalled();
  });
  it('does not send to a stale recipient after associations were edited', async () => {
    prisma.drawingCard.findUnique
      .mockResolvedValueOnce(card)
      .mockResolvedValueOnce({
        ...card,
        updatedAt: new Date('2026-10-28T12:01:00Z'),
      });
    await expect(service.send('card', 'image', 'salon')).rejects.toThrow(
      'liaisons de cette card ont changé',
    );
    expect(mail.sendMail).not.toHaveBeenCalled();
  });
});
