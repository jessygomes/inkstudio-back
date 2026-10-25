import { MessageNotificationService } from './message-notification.service';

describe('Unread messages and standalone project requests', () => {
  it('counts pending project requests before any conversation exists', async () => {
    const prisma: any = {
      messageNotification: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { unreadCount: null } }),
      },
      projectProposal: { count: jest.fn().mockResolvedValue(2) },
    };
    const service = new MessageNotificationService(prisma);
    await expect(service.getTotalUnreadCount('client')).resolves.toBe(2);
    expect(prisma.projectProposal.count).toHaveBeenCalledWith({
      where: { clientUserId: 'client', status: 'PENDING' },
    });
  });

  it('adds only pending requests to existing unread messages', async () => {
    const prisma: any = {
      messageNotification: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { unreadCount: 3 } }),
      },
      projectProposal: { count: jest.fn().mockResolvedValue(1) },
    };
    await expect(
      new MessageNotificationService(prisma).getTotalUnreadCount('client'),
    ).resolves.toBe(4);
  });
});
