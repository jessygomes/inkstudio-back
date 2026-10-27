import { NotificationPreferenceService } from './notification-preference.service';

describe('Chat email notification frequency', () => {
  it('creates hourly preferences and converts legacy immediate settings', async () => {
    const prisma = { notificationPreference: {
      findUnique: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ userId: 'u', emailFrequency: 'IMMEDIATE' }),
      create: jest.fn(async ({ data }) => data), update: jest.fn(async ({ data }) => data),
    } } as any;
    const service = new NotificationPreferenceService(prisma);
    expect((await service.getPreferences('u')).emailFrequency).toBe('HOURLY');
    expect((await service.getPreferences('u')).emailFrequency).toBe('HOURLY');
  });
  it('rejects immediate notifications even through the API service', async () => {
    const prisma = { notificationPreference: { upsert: jest.fn() } } as any;
    await expect(new NotificationPreferenceService(prisma).updatePreferences('u', { emailFrequency: 'IMMEDIATE' })).rejects.toThrow();
    expect(prisma.notificationPreference.upsert).not.toHaveBeenCalled();
  });
});
