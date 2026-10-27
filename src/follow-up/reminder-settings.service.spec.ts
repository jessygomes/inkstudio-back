import { ReminderSettingsService } from './reminder-settings.service';
import { DEFAULT_FOLLOW_UP_MESSAGE, DEFAULT_RETOUCH_MESSAGE } from './reminder-settings';
import { UpdateReminderSettingsDto } from './reminder-settings.controller';
import { validate } from 'class-validator';

describe('Reminder settings', () => {
  const settings = { followUpEmailDelayDays: 9, retouchEmailDelayDays: 45, followUpDeliveryChannel: 'BOTH' as const, retouchDeliveryChannel: 'INKERA' as const,
    followUpMessage: 'Bonjour {prenom}', retouchMessage: 'Contactez {salon}' };
  it('returns existing day settings without replacing them with new defaults', async () => {
    const prisma = { user: { findUnique: jest.fn(async () => ({ role: 'user_salon', ...settings, followUpMessage: null, retouchMessage: null })) } } as any;
    const result = await new ReminderSettingsService(prisma, {} as any).get('owner');
    expect(result.settings.followUpEmailDelayDays).toBe(9);
    expect(result.settings.retouchEmailDelayDays).toBe(45);
    expect(result.settings.followUpMessage).toBe(DEFAULT_FOLLOW_UP_MESSAGE);
    expect(result.settings.retouchMessage).toBe(DEFAULT_RETOUCH_MESSAGE);
  });
  it('stores only the authenticated professional settings and invalidates legacy caches', async () => {
    const prisma = { user: { findUnique: jest.fn(async () => ({ role: 'user_tatoueur', ...settings })), update: jest.fn() } } as any;
    const cache = { del: jest.fn(), delPattern: jest.fn() } as any;
    await new ReminderSettingsService(prisma, cache).update('owner', settings);
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'owner' }, data: settings });
    expect(cache.del).toHaveBeenCalledWith('user:appointment-booking:owner');
  });
  it('rejects unknown variables and blank messages', async () => {
    const prisma = { user: { findUnique: jest.fn(async () => ({ role: 'user_salon' })), update: jest.fn() } } as any;
    const service = new ReminderSettingsService(prisma, {} as any);
    await expect(service.update('owner', { ...settings, followUpMessage: '{unknown}' })).rejects.toThrow('Variable inconnue');
    await expect(service.update('owner', { ...settings, followUpMessage: '  ' })).rejects.toThrow('vide');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
  it('refuses client accounts', async () => {
    const prisma = { user: { findUnique: jest.fn(async () => ({ role: 'client' })) } } as any;
    await expect(new ReminderSettingsService(prisma, {} as any).get('client')).rejects.toThrow();
  });
  it.each([{ followUpEmailDelayDays: 0 }, { retouchEmailDelayDays: 1.5 }, { followUpDeliveryChannel: 'SMS' }, { followUpMessage: 'x'.repeat(3001) }])('validates settings at the API boundary %j', async patch => {
    const input = Object.assign(new UpdateReminderSettingsDto(), settings, patch);
    expect((await validate(input)).length).toBeGreaterThan(0);
  });
});
