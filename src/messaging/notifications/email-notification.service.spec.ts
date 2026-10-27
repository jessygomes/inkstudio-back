import { EmailNotificationService } from './email-notification.service';

describe('Grouped chat email notifications', () => {
  function setup(frequency: string, ageHours: number, enabled = true) {
    const queue = {
      id: 'queue',
      status: 'PENDING',
      createdAt: new Date(Date.now() - ageHours * 3600_000),
      recipientUserId: 'client',
      messageCount: 3,
      conversation: {
        id: 'chat',
        salonId: 'professional',
        clientUserId: 'client',
        salon: { id: 'professional', salonName: 'Studio' },
        clientUser: {
          id: 'client',
          firstName: 'Client',
          email: 'client@example.com',
        },
        messages: [],
      },
    };
    const prisma = {
      emailNotificationQueue: {
        findUnique: jest.fn(async () => queue),
        findFirst: jest.fn(async () => null),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
    } as any;
    const preferences = {
      getPreferences: jest.fn(async () => ({
        emailFrequency: frequency,
        emailNotificationsEnabled: enabled,
        mutedConversations: [],
      })),
    } as any;
    const mail = { sendEmail: jest.fn() } as any;
    const rateLimit = { recordEmailSent: jest.fn() } as any;
    return {
      service: new EmailNotificationService(
        prisma,
        preferences,
        mail,
        rateLimit,
      ),
      prisma,
      mail,
    };
  }
  it.each([
    ['HOURLY', 0.5],
    ['DAILY', 23],
  ])(
    'does not send %s before its grouping interval',
    async (frequency, hours) => {
      const { service, mail } = setup(frequency as string, hours as number);
      await service.sendNotification('queue');
      expect(mail.sendEmail).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['HOURLY', 2],
    ['DAILY', 25],
  ])('sends %s once the interval has elapsed', async (frequency, hours) => {
    const { service, mail, prisma } = setup(
      frequency as string,
      hours as number,
    );
    await service.sendNotification('queue');
    expect(mail.sendEmail).toHaveBeenCalledTimes(1);
    expect(prisma.emailNotificationQueue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SENT' }),
      }),
    );
  });
  it('cancels pending notifications when the user chooses Never', async () => {
    const { service, mail, prisma } = setup('NEVER', 100);
    await service.sendNotification('queue');
    expect(mail.sendEmail).not.toHaveBeenCalled();
    expect(prisma.emailNotificationQueue.deleteMany).toHaveBeenCalled();
  });
  it('rechecks the last sent notification to prevent bursts after an earlier email', async () => {
    const { service, mail, prisma } = setup('HOURLY', 3);
    prisma.emailNotificationQueue.findFirst.mockResolvedValue({
      sentAt: new Date(),
    });
    await service.sendNotification('queue');
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });
});
