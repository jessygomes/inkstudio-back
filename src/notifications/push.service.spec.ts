import { BadRequestException } from '@nestjs/common';
import { PushService } from './push.service';

const TOKEN = 'ExponentPushToken[abcdefghijklmnop]';
const TOKEN_2 = 'ExponentPushToken[qrstuvwxyz012345]';

function build() {
  const prisma = {
    pushDevice: {
      upsert: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([{ token: TOKEN }, { token: TOKEN_2 }]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const service = new PushService(prisma as never);
  const expo = {
    chunkPushNotifications: jest.fn((messages: unknown[]) => [messages]),
    sendPushNotificationsAsync: jest.fn().mockResolvedValue([{ status: 'ok', id: 'a' }, { status: 'ok', id: 'b' }]),
  };
  (service as unknown as { expo: typeof expo }).expo = expo;
  return { service, prisma, expo };
}

describe('PushService', () => {
  describe('registerDevice', () => {
    it('enregistre ou met à jour l’appareil (le jeton change de compte à la connexion suivante)', async () => {
      const { service, prisma } = build();
      await service.registerDevice('u1', TOKEN, 'android');
      expect(prisma.pushDevice.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { token: TOKEN },
        create: { userId: 'u1', token: TOKEN, platform: 'android', app: 'studio' },
        update: expect.objectContaining({ userId: 'u1', platform: 'android', app: 'studio' }),
      }));
    });

    it('refuse un jeton qui n’est pas un jeton Expo', async () => {
      const { service, prisma } = build();
      await expect(service.registerDevice('u1', 'pas-un-jeton', 'android')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.pushDevice.upsert).not.toHaveBeenCalled();
    });
  });

  it('unregisterDevice ne retire que l’appareil du compte', async () => {
    const { service, prisma } = build();
    await service.unregisterDevice('u1', TOKEN);
    expect(prisma.pushDevice.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1', token: TOKEN } });
  });

  describe('send', () => {
    it('envoie la notification à tous les appareils, avec les données pour ouvrir le bon écran', async () => {
      const { service, expo } = build();
      await service.send('u1', { title: 'Nouveau rendez-vous', body: 'Jeanne · samedi 14h30', data: { appointmentId: 'a1', type: 'appointment.created' } });
      const sent = expo.sendPushNotificationsAsync.mock.calls[0][0] as Array<Record<string, unknown>>;
      expect(sent).toHaveLength(2);
      expect(sent[0]).toEqual(expect.objectContaining({
        to: TOKEN, title: 'Nouveau rendez-vous', body: 'Jeanne · samedi 14h30', sound: 'default', priority: 'high', channelId: 'default',
        data: { appointmentId: 'a1', type: 'appointment.created' },
      }));
    });

    it('ne fait rien sans appareil enregistré', async () => {
      const { service, prisma, expo } = build();
      prisma.pushDevice.findMany.mockResolvedValue([]);
      await service.send('u1', { title: 't', body: 'b' });
      expect(expo.sendPushNotificationsAsync).not.toHaveBeenCalled();
    });

    it('tronque un texte trop long', async () => {
      const { service, expo } = build();
      await service.send('u1', { title: 't', body: 'x'.repeat(500) });
      const body = (expo.sendPushNotificationsAsync.mock.calls[0][0] as Array<{ body: string }>)[0].body;
      expect(body.length).toBeLessThanOrEqual(240);
      expect(body.endsWith('…')).toBe(true);
    });

    it('oublie les appareils qui ne sont plus enregistrés (app désinstallée)', async () => {
      const { service, prisma, expo } = build();
      expo.sendPushNotificationsAsync.mockResolvedValue([{ status: 'ok', id: 'a' }, { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } }]);
      await service.send('u1', { title: 't', body: 'b' });
      expect(prisma.pushDevice.deleteMany).toHaveBeenCalledWith({ where: { token: { in: [TOKEN_2] } } });
    });

    it('ne lève jamais d’erreur si l’envoi échoue', async () => {
      const { service, expo } = build();
      expo.sendPushNotificationsAsync.mockRejectedValue(new Error('réseau'));
      await expect(service.send('u1', { title: 't', body: 'b' })).resolves.toBeUndefined();
    });
  });
});
