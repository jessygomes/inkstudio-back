import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { PushService } from './push.service';
import {
  NOTIFICATION_TYPES,
  NotificationCategory,
  NotificationType,
  NotificationTypeDef,
  categoriesForRole,
} from './notification-catalog';

export type NotifyInput = {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Identifiants pour ouvrir le bon écran (appointmentId, conversationId, ...). */
  data?: Record<string, unknown>;
  /** Une seule notification par (utilisateur, clé) : pour les rappels et résumés. */
  dedupeKey?: string;
  /** Limite la notification à un seul canal : `push` (rien dans le centre) ou `inApp` (pas de push). Par défaut : les deux, selon les préférences. */
  only?: 'push' | 'inApp';
};

export type RealtimeEmitter = (userId: string, event: string, payload: unknown) => void;

export type NotificationDto = {
  id: string;
  type: string;
  category: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  readAt: Date | null;
  createdAt: Date;
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private emitter: RealtimeEmitter | null = null;

  constructor(
    private readonly prisma: PrismaService,
    // Facultatif : sans lui (tests, scripts), seules les notifications dans l'app sont créées.
    @Optional() private readonly push?: PushService,
  ) {}

  /** La passerelle temps réel s'enregistre ici (évite une dépendance circulaire avec la messagerie). */
  registerEmitter(emitter: RealtimeEmitter): void {
    this.emitter = emitter;
  }

  /**
   * Crée une notification pour un utilisateur si sa catégorie est activée. Ne lève jamais d'erreur :
   * une notification ratée ne doit pas faire échouer l'action métier qui l'a déclenchée.
   * Retourne la notification, ou null si elle a été ignorée (préférence, doublon, erreur).
   */
  async notify(input: NotifyInput): Promise<NotificationDto | null> {
    try {
      const def = NOTIFICATION_TYPES[input.type] as NotificationTypeDef | undefined;
      if (!def) return null;
      // Canaux indépendants : dans l'app et push (les types critiques partent toujours).
      const wantInApp = input.only !== 'push' && (def.critical || (await this.isEnabled(input.userId, def.category, 'inApp')));
      const wantPush = !!this.push && input.only !== 'inApp' && (def.critical || (await this.isEnabled(input.userId, def.category, 'push')));
      if (!wantInApp && !wantPush) return null;
      if (!wantInApp) {
        // Push seul : pas d'entrée dans le centre de notifications.
        void this.push!.send(input.userId, { title: input.title, body: input.body, data: { ...input.data, type: input.type, category: def.category } });
        return null;
      }

      let row;
      try {
        row = await this.prisma.appNotification.create({
          data: {
            userId: input.userId,
            type: input.type,
            category: def.category,
            title: input.title,
            body: input.body,
            data: (input.data ?? undefined) as Prisma.InputJsonValue | undefined,
            dedupeKey: input.dedupeKey,
          },
        });
      } catch (e) {
        // Doublon (même clé de déduplication) : volontairement ignoré.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null;
        throw e;
      }
      const dto = this.toDto(row);
      this.emit(input.userId, 'notification-created', dto);
      void this.emitUnread(input.userId);
      if (wantPush) void this.sendPush(input.userId, dto);
      return dto;
    } catch (e) {
      this.logger.error(`Notification ${input.type} non créée : ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  /**
   * Regroupe les rafales : s'il existe déjà une notification non lue du même type pour la même clé (ex. conversationId),
   * elle est mise à jour (compteur, aperçu, date) au lieu d'en créer une nouvelle.
   */
  async notifyGrouped(input: NotifyInput, groupField: string, makeBody: (count: number, latest: string) => string, latest: string): Promise<NotificationDto | null> {
    try {
      const groupValue = input.data?.[groupField];
      if (typeof groupValue === 'string') {
        const existing = await this.prisma.appNotification.findFirst({
          where: { userId: input.userId, type: input.type, readAt: null, data: { path: [groupField], equals: groupValue } },
          orderBy: { createdAt: 'desc' },
        });
        if (existing) {
          const previous = typeof (existing.data as Record<string, unknown> | null)?.count === 'number' ? ((existing.data as Record<string, unknown>).count as number) : 1;
          const count = previous + 1;
          const row = await this.prisma.appNotification.update({
            where: { id: existing.id },
            data: { body: makeBody(count, latest), createdAt: new Date(), data: { ...input.data, count } as Prisma.InputJsonValue },
          });
          const dto = this.toDto(row);
          this.emit(input.userId, 'notification-created', dto);
          void this.pushIfEnabled(input.userId, dto);
          return dto;
        }
      }
      return await this.notify({ ...input, body: makeBody(1, latest), data: { ...input.data, count: 1 } });
    } catch (e) {
      this.logger.error(`Notification groupée ${input.type} non créée : ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  /** Nom affichable d'un compte : salon, sinon prénom + nom. */
  async displayName(userId: string | null | undefined): Promise<string> {
    if (!userId) return '';
    try {
      const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { salonName: true, firstName: true, lastName: true } });
      return u?.salonName || [u?.firstName, u?.lastName].filter(Boolean).join(' ') || '';
    } catch {
      return '';
    }
  }

  /** Notifie plusieurs destinataires (doublons d'identifiants retirés). */
  async notifyMany(userIds: Array<string | null | undefined>, input: Omit<NotifyInput, 'userId'>): Promise<void> {
    const unique = [...new Set(userIds.filter((id): id is string => !!id))];
    await Promise.all(unique.map((userId) => this.notify({ ...input, userId })));
  }

  async list(userId: string, opts: { cursor?: string; limit?: number; unreadOnly?: boolean } = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
    const rows = await this.prisma.appNotification.findMany({
      where: { userId, ...(opts.unreadOnly ? { readAt: null } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page.map((r) => this.toDto(r)),
      nextCursor: hasMore ? page[page.length - 1].id : null,
      unreadCount: await this.unreadCount(userId),
    };
  }

  unreadCount(userId: string): Promise<number> {
    return this.prisma.appNotification.count({ where: { userId, readAt: null } });
  }

  async markRead(userId: string, id: string): Promise<{ unreadCount: number }> {
    await this.prisma.appNotification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
    return { unreadCount: await this.emitUnread(userId) };
  }

  async markAllRead(userId: string): Promise<{ unreadCount: number }> {
    await this.prisma.appNotification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    return { unreadCount: await this.emitUnread(userId) };
  }

  async remove(userId: string, id: string): Promise<{ unreadCount: number }> {
    await this.prisma.appNotification.deleteMany({ where: { id, userId } });
    return { unreadCount: await this.emitUnread(userId) };
  }

  /** Supprime les notifications plus anciennes que `days` jours (lues ou non). */
  async purgeOlderThan(days: number): Promise<number> {
    const { count } = await this.prisma.appNotification.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - days * 86_400_000) } },
    });
    return count;
  }

  // ---------- Préférences par catégorie ----------

  async getPreferences(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    const rows = await this.prisma.notificationCategoryPreference.findMany({ where: { userId } });
    const byCategory = new Map(rows.map((r) => [r.category, r]));
    return {
      categories: categoriesForRole(user?.role).map((category) => ({
        category,
        inApp: byCategory.get(category)?.inApp ?? true,
        push: byCategory.get(category)?.push ?? true,
      })),
    };
  }

  async updatePreference(userId: string, category: NotificationCategory, patch: { inApp?: boolean; push?: boolean }) {
    await this.prisma.notificationCategoryPreference.upsert({
      where: { userId_category: { userId, category } },
      create: { userId, category, inApp: patch.inApp ?? true, push: patch.push ?? true },
      update: {
        ...(patch.inApp !== undefined ? { inApp: patch.inApp } : {}),
        ...(patch.push !== undefined ? { push: patch.push } : {}),
      },
    });
    return this.getPreferences(userId);
  }

  async isEnabled(userId: string, category: NotificationCategory, channel: 'inApp' | 'push'): Promise<boolean> {
    const pref = await this.prisma.notificationCategoryPreference.findUnique({
      where: { userId_category: { userId, category } },
      select: { inApp: true, push: true },
    });
    return pref ? pref[channel] : true;
  }

  // ---------- Push ----------

  /** Envoie la notification en push (les données ouvrent le bon écran au toucher). */
  private sendPush(userId: string, dto: NotificationDto): Promise<void> {
    if (!this.push) return Promise.resolve();
    return this.push.send(userId, { title: dto.title, body: dto.body, data: { ...(dto.data ?? {}), notificationId: dto.id, type: dto.type, category: dto.category } });
  }

  /** Push d'une notification groupée mise à jour : seulement si le destinataire l'a activé pour cette catégorie. */
  private async pushIfEnabled(userId: string, dto: NotificationDto): Promise<void> {
    const def = NOTIFICATION_TYPES[dto.type as NotificationType] as NotificationTypeDef | undefined;
    if (!def || !this.push) return;
    if (def.critical || (await this.isEnabled(userId, def.category, 'push'))) await this.sendPush(userId, dto);
  }

  // ---------- Interne ----------

  private async emitUnread(userId: string): Promise<number> {
    const unreadCount = await this.unreadCount(userId);
    this.emit(userId, 'notification-unread-count', { unreadCount });
    return unreadCount;
  }

  private emit(userId: string, event: string, payload: unknown): void {
    try {
      this.emitter?.(userId, event, payload);
    } catch (e) {
      this.logger.warn(`Émission temps réel impossible : ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private toDto(row: {
    id: string;
    type: string;
    category: string;
    title: string;
    body: string;
    data: Prisma.JsonValue | null;
    readAt: Date | null;
    createdAt: Date;
  }): NotificationDto {
    return {
      id: row.id,
      type: row.type,
      category: row.category,
      title: row.title,
      body: row.body,
      data: row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? (row.data as Record<string, unknown>) : null,
      readAt: row.readAt,
      createdAt: row.createdAt,
    };
  }
}
