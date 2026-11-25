import { grantClientAccessOnBooking } from './grant-on-booking';

describe('grantClientAccessOnBooking', () => {
  let prisma: any;
  beforeEach(() => {
    prisma = {
      conversation: {
        findMany: jest.fn().mockResolvedValue([{ id: 'conv', salonId: 'pro' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      message: { create: jest.fn() },
      inboxThread: { updateMany: jest.fn() },
    };
  });

  it('opens the hidden conversations of the booked professional and links the client record', async () => {
    await expect(grantClientAccessOnBooking(prisma, { professionalIds: ['pro', null, 'pro'], clientUserId: 'client', clientId: 'fiche', clientOwnerId: 'pro' })).resolves.toEqual(['conv']);
    expect(prisma.conversation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { clientUserId: 'client', salonId: { in: ['pro'] }, clientAccess: { in: ['HIDDEN', 'REQUESTED', 'DECLINED'] } },
    }));
    expect(prisma.conversation.updateMany.mock.calls[0][0].data.clientAccess).toBe('GRANTED');
    expect(prisma.message.create.mock.calls[0][0].data).toMatchObject({ conversationId: 'conv', senderId: 'client', type: 'SYSTEM' });
    expect(prisma.inboxThread.updateMany).toHaveBeenCalledWith({ where: { conversationId: 'conv', linkedClientId: null }, data: { linkedClientId: 'fiche' } });
  });

  it('does not link a client record owned by another professional', async () => {
    await grantClientAccessOnBooking(prisma, { professionalIds: ['pro'], clientUserId: 'client', clientId: 'fiche', clientOwnerId: 'salon' });
    expect(prisma.inboxThread.updateMany).not.toHaveBeenCalled();
  });

  it('does nothing for a guest booking and never throws', async () => {
    await expect(grantClientAccessOnBooking(prisma, { professionalIds: ['pro'], clientUserId: null })).resolves.toEqual([]);
    expect(prisma.conversation.findMany).not.toHaveBeenCalled();
    prisma.conversation.findMany.mockRejectedValue(new Error('db'));
    await expect(grantClientAccessOnBooking(prisma, { professionalIds: ['pro'], clientUserId: 'client' })).resolves.toEqual([]);
  });

  it('skips a conversation already answered in between', async () => {
    prisma.conversation.updateMany.mockResolvedValue({ count: 0 });
    await expect(grantClientAccessOnBooking(prisma, { professionalIds: ['pro'], clientUserId: 'client' })).resolves.toEqual([]);
    expect(prisma.message.create).not.toHaveBeenCalled();
  });
});
