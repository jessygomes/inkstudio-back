import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';
import { PrismaService } from '../database/prisma.service';

export type PushPayload = {
  title: string;
  body: string;
  /** Repris tel quel dans la notification : l'app s'en sert pour ouvrir le bon écran au toucher. */
  data?: Record<string, unknown>;
};

export const PUSH_PLATFORMS = ['android', 'ios'] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

/** Taille maximale d'un texte de notification (les téléphones tronquent de toute façon). */
const MAX_BODY = 240;

/**
 * Notifications push (celles que le téléphone affiche, app fermée) via le service Push d'Expo, qui relaie vers FCM (Android) et APNs (iOS).
 * Ne lève jamais d'erreur à l'envoi : un push raté ne doit pas faire échouer l'action métier qui l'a déclenché.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  /** `EXPO_ACCESS_TOKEN` (facultatif) : jeton d'accès Expo si la « sécurité renforcée » des notifications est activée sur le projet. */
  private readonly expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN || undefined });

  constructor(private readonly prisma: PrismaService) {}

  /** Enregistre (ou met à jour) l'appareil d'un utilisateur. Un jeton appartient à un seul compte : il change de propriétaire à la connexion suivante. */
  async registerDevice(userId: string, token: string, platform: PushPlatform, app = 'studio') {
    if (!Expo.isExpoPushToken(token)) throw new BadRequestException("Jeton de notification invalide.");
    await this.prisma.pushDevice.upsert({
      where: { token },
      create: { userId, token, platform, app },
      update: { userId, platform, app, lastSeenAt: new Date() },
    });
    return { ok: true };
  }

  /** Retire l'appareil du compte (déconnexion, push désactivé) : il ne reçoit plus rien pour ce compte. */
  async unregisterDevice(userId: string, token: string) {
    await this.prisma.pushDevice.deleteMany({ where: { userId, token } });
    return { ok: true };
  }

  /** Envoie une notification à tous les appareils d'un utilisateur. */
  async send(userId: string, payload: PushPayload): Promise<void> {
    try {
      const devices = await this.prisma.pushDevice.findMany({ where: { userId }, select: { token: true } });
      if (!devices.length) return;

      const messages: ExpoPushMessage[] = devices
        .filter((device) => Expo.isExpoPushToken(device.token))
        .map((device) => ({
          to: device.token,
          title: payload.title,
          body: payload.body.length > MAX_BODY ? `${payload.body.slice(0, MAX_BODY - 1)}…` : payload.body,
          data: payload.data ?? {},
          sound: 'default',
          priority: 'high',
          channelId: 'default',
        }));
      if (!messages.length) return;

      const dead: string[] = [];
      for (const chunk of this.expo.chunkPushNotifications(messages)) {
        const tickets: ExpoPushTicket[] = await this.expo.sendPushNotificationsAsync(chunk);
        tickets.forEach((ticket, index) => {
          if (ticket.status !== 'error') return;
          // L'appareil a désinstallé l'app ou révoqué la permission : on oublie son jeton.
          if (ticket.details?.error === 'DeviceNotRegistered') dead.push(String(chunk[index].to));
          else this.logger.warn(`Push refusé (${ticket.details?.error ?? 'erreur inconnue'}) : ${ticket.message}`);
        });
      }
      if (dead.length) await this.prisma.pushDevice.deleteMany({ where: { token: { in: dead } } });
    } catch (e) {
      this.logger.error(`Push non envoyé à ${userId} : ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
