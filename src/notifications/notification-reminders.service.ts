import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from './notifications.service';
import { formatRdvWhen } from './appointment-notifications';

const TZ = 'Europe/Paris';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const PRO_ROLES = ['user', 'user_salon', 'user_tatoueur'] as const;

/** Date et heure à Paris. */
function paris(now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, month: `${get('year')}-${get('month')}`, hour: Number(get('hour')), weekday: get('weekday') };
}
const clock = (d: Date) => {
  const p = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  return `${p.find((x) => x.type === 'hour')?.value}h${p.find((x) => x.type === 'minute')?.value}`;
};
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/**
 * Rappels planifiés du centre de notifications (Studio). Exécuté toutes les 15 minutes : chaque rappel porte une clé de
 * déduplication, donc rejouer le passage ne crée jamais de doublon et un retard d'exécution se rattrape tout seul.
 */
@Injectable()
export class NotificationRemindersService {
  private readonly logger = new Logger(NotificationRemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async run(now: Date = new Date()): Promise<void> {
    const steps: Array<[string, () => Promise<void>]> = [
      ['rappel avant rendez-vous', () => this.appointmentReminders(now)],
      ['rendez-vous terminé à clôturer', () => this.finishedAppointments(now)],
      ['messages sans réponse', () => this.unansweredMessages(now)],
      ['récapitulatif du jour', () => this.daySummary(now)],
      ['rendez-vous en attente', () => this.staleRequests(now)],
      ['conflits d’agenda', () => this.agendaConflicts(now)],
      ['péremptions', () => this.expiringStock(now)],
      ['profil incomplet', () => this.incompleteProfiles(now)],
      ['bilan hebdomadaire', () => this.weeklyReport(now)],
      ['purge', async () => { await this.notifications.purgeOlderThan(90); }],
    ];
    for (const [name, step] of steps) {
      try { await step(); } catch (e) { this.logger.error(`Rappel « ${name} » en échec : ${e instanceof Error ? e.message : String(e)}`); }
    }
  }

  /** Rendez-vous confirmés qui commencent dans l'heure. */
  private async appointmentReminders(now: Date) {
    const rows = await this.prisma.appointment.findMany({
      where: { status: 'CONFIRMED', start: { gt: now, lte: new Date(now.getTime() + HOUR) } },
      select: { id: true, userId: true, performerUserId: true, start: true, title: true, client: { select: { firstName: true, lastName: true } } },
    });
    for (const a of rows) {
      const client = [a.client?.firstName, a.client?.lastName].filter(Boolean).join(' ');
      for (const userId of new Set([a.userId, a.performerUserId].filter((x): x is string => !!x))) {
        await this.notifications.notify({
          userId, type: 'appointment.reminder', title: `Rendez-vous à ${clock(a.start)}`,
          body: [client || 'Client', a.title].filter(Boolean).join(' · '), data: { appointmentId: a.id }, dedupeKey: `reminder:${a.id}`,
        });
      }
    }
  }

  /** Rendez-vous confirmés terminés depuis plus de 30 min (à marquer complété ou absent) ; terminés non réglés. */
  private async finishedAppointments(now: Date) {
    const stale = await this.prisma.appointment.findMany({
      where: { status: 'CONFIRMED', end: { lt: new Date(now.getTime() - 30 * MIN), gt: new Date(now.getTime() - 2 * DAY) } },
      select: { id: true, userId: true, performerUserId: true, start: true, client: { select: { firstName: true, lastName: true } } },
    });
    for (const a of stale) {
      const client = [a.client?.firstName, a.client?.lastName].filter(Boolean).join(' ');
      for (const userId of new Set([a.userId, a.performerUserId].filter((x): x is string => !!x))) {
        await this.notifications.notify({
          userId, type: 'appointment.no_show_check', title: 'Rendez-vous à clôturer',
          body: `${client || 'Client'} · ${formatRdvWhen(a.start)} : marquez-le comme complété ou client absent.`, data: { appointmentId: a.id }, dedupeKey: `noshow:${a.id}`,
        });
      }
    }
    const unpaid = await this.prisma.appointment.findMany({
      where: { status: 'COMPLETED', isPayed: false, end: { lt: new Date(now.getTime() - DAY), gt: new Date(now.getTime() - 14 * DAY) } },
      select: { id: true, userId: true, start: true, client: { select: { firstName: true, lastName: true } } },
    });
    for (const a of unpaid) {
      const client = [a.client?.firstName, a.client?.lastName].filter(Boolean).join(' ');
      await this.notifications.notify({
        userId: a.userId, type: 'appointment.payment_due', title: 'Paiement non réglé',
        body: `${client || 'Client'} · ${formatRdvWhen(a.start)} n’est pas marqué comme réglé.`, data: { appointmentId: a.id }, dedupeKey: `paydue:${a.id}`,
      });
    }
  }

  /** Messages de clients restés sans réponse depuis plus de 24 h (une alerte par message non lu). */
  private async unansweredMessages(now: Date) {
    const rows = await this.prisma.messageNotification.findMany({
      where: { unreadCount: { gt: 0 }, lastUnreadAt: { lt: new Date(now.getTime() - DAY), gt: new Date(now.getTime() - 3 * DAY) }, user: { role: { in: [...PRO_ROLES] } } },
      select: { userId: true, conversationId: true, lastUnreadAt: true, conversation: { select: { clientUser: { select: { firstName: true, lastName: true } } } } },
    });
    for (const r of rows) {
      const name = [r.conversation.clientUser?.firstName, r.conversation.clientUser?.lastName].filter(Boolean).join(' ');
      await this.notifications.notify({
        userId: r.userId, type: 'message.unanswered', title: 'Message sans réponse',
        body: `${name || 'Un client'} attend votre réponse depuis plus de 24 h.`, data: { conversationId: r.conversationId },
        dedupeKey: `unanswered:${r.conversationId}:${r.lastUnreadAt?.toISOString()}`,
      });
    }
  }

  /** Chaque matin (à partir de 8 h) : les rendez-vous confirmés du jour. */
  private async daySummary(now: Date) {
    const p = paris(now);
    if (p.hour < 8 || p.hour >= 12) return;
    const start = new Date(now.getTime() - 14 * HOUR);
    const end = new Date(now.getTime() + 24 * HOUR);
    const rows = await this.prisma.appointment.findMany({
      where: { status: 'CONFIRMED', start: { gte: start, lte: end }, end: { gt: now } },
      select: { id: true, userId: true, performerUserId: true, start: true },
      orderBy: { start: 'asc' },
    });
    const byUser = new Map<string, Date[]>();
    for (const a of rows) {
      if (paris(a.start).date !== p.date) continue;
      for (const userId of new Set([a.userId, a.performerUserId].filter((x): x is string => !!x))) byUser.set(userId, [...(byUser.get(userId) ?? []), a.start]);
    }
    for (const [userId, starts] of byUser) {
      await this.notifications.notify({
        userId, type: 'appointment.day_summary', title: `Aujourd’hui : ${plural(starts.length, 'rendez-vous', 'rendez-vous')}`,
        body: `Le premier est à ${clock(starts[0])}.`, dedupeKey: `day:${p.date}`,
      });
    }
  }

  /** Demandes de rendez-vous en attente depuis plus de 24 h : un rappel par jour et par professionnel. */
  private async staleRequests(now: Date) {
    const p = paris(now);
    if (p.hour < 9 || p.hour >= 20) return;
    const rows = await this.prisma.appointment.groupBy({
      by: ['userId'], _count: { _all: true },
      where: { status: 'PENDING', createdAt: { lt: new Date(now.getTime() - DAY) }, start: { gt: now } },
    });
    for (const r of rows) {
      await this.notifications.notify({
        userId: r.userId, type: 'appointment.pending_stale', title: 'Rendez-vous à confirmer',
        body: `${plural(r._count._all, 'demande attend', 'demandes attendent')} votre confirmation depuis plus de 24 h.`, dedupeKey: `pending:${p.date}`,
      });
    }
  }

  /** Une fois par jour : rendez-vous qui se chevauchent chez un même artiste dans les 14 prochains jours. */
  private async agendaConflicts(now: Date) {
    const p = paris(now);
    if (p.hour < 7 || p.hour >= 10) return;
    const rows = await this.prisma.appointment.findMany({
      where: { status: { in: ['PENDING', 'CONFIRMED'] }, start: { gte: now, lte: new Date(now.getTime() + 14 * DAY) } },
      select: { id: true, userId: true, performerUserId: true, tatoueurId: true, start: true, end: true },
      orderBy: { start: 'asc' },
    });
    const groups = new Map<string, typeof rows>();
    for (const a of rows) {
      const key = `${a.userId}:${a.performerUserId ?? a.tatoueurId ?? 'self'}`;
      groups.set(key, [...(groups.get(key) ?? []), a]);
    }
    for (const list of groups.values()) {
      for (let i = 1; i < list.length; i++) {
        const prev = list[i - 1];
        const cur = list[i];
        if (cur.start < prev.end) {
          const ids = [prev.id, cur.id].sort().join(':');
          for (const userId of new Set([cur.userId, cur.performerUserId].filter((x): x is string => !!x))) {
            await this.notifications.notify({
              userId, type: 'appointment.conflict', title: 'Conflit d’agenda',
              body: `Deux rendez-vous se chevauchent le ${formatRdvWhen(cur.start)}.`, data: { appointmentId: cur.id }, dedupeKey: `conflict:${ids}`,
            });
          }
        }
      }
    }
  }

  /** Produits qui expirent dans les 30 jours (une alerte par produit et par date de péremption). */
  private async expiringStock(now: Date) {
    const p = paris(now);
    if (p.hour < 9 || p.hour >= 12) return;
    const rows = await this.prisma.stockItem.findMany({
      where: { expirationDate: { gt: now, lte: new Date(now.getTime() + 30 * DAY) }, quantity: { gt: 0 } },
      select: { id: true, userId: true, name: true, expirationDate: true },
    });
    for (const s of rows) {
      const days = Math.max(1, Math.ceil((s.expirationDate!.getTime() - now.getTime()) / DAY));
      await this.notifications.notify({
        userId: s.userId, type: 'stock.expiring', title: 'Produit bientôt périmé',
        body: `${s.name} expire dans ${plural(days, 'jour', 'jours')}.`, data: { stockItemId: s.id }, dedupeKey: `expiring:${s.id}:${s.expirationDate!.toISOString().slice(0, 10)}`,
      });
    }
  }

  /** Une fois par mois (le lundi) : comptes professionnels dont la vitrine n'est pas complète. */
  private async incompleteProfiles(now: Date) {
    const p = paris(now);
    if (p.weekday !== 'Mon' || p.hour < 10 || p.hour >= 14) return;
    const users = await this.prisma.user.findMany({
      where: { role: { in: ['user_salon', 'user_tatoueur'] }, OR: [{ profileImage: null }, { description: null }, { address: null }, { prestations: { isEmpty: true } }] },
      select: { id: true, profileImage: true, description: true, address: true, prestations: true },
      take: 2000,
    });
    for (const u of users) {
      const missing = [!u.profileImage && 'une photo de profil', !u.description && 'une présentation', !u.address && 'une adresse', !u.prestations?.length && 'vos prestations'].filter(Boolean);
      if (!missing.length) continue;
      await this.notifications.notify({
        userId: u.id, type: 'account.profile_incomplete', title: 'Complétez votre profil',
        body: `Ajoutez ${missing.slice(0, 2).join(' et ')} pour mieux apparaître dans Explorer.`, dedupeKey: `profile:${p.month}`,
      });
    }
  }

  /** Chaque lundi matin : bilan de la semaine écoulée. */
  private async weeklyReport(now: Date) {
    const p = paris(now);
    if (p.weekday !== 'Mon' || p.hour < 8 || p.hour >= 12) return;
    const since = new Date(now.getTime() - 7 * DAY);
    const done = await this.prisma.appointment.groupBy({ by: ['userId'], _count: { _all: true }, where: { status: 'COMPLETED', start: { gte: since, lt: now } } });
    const upcoming = await this.prisma.appointment.groupBy({ by: ['userId'], _count: { _all: true }, where: { status: 'CONFIRMED', start: { gte: now, lt: new Date(now.getTime() + 7 * DAY) } } });
    const reviews = await this.prisma.salonReview.groupBy({ by: ['salonId'], _count: { _all: true }, where: { createdAt: { gte: since } } });
    const ids = new Set<string>([...done.map((d) => d.userId), ...upcoming.map((d) => d.userId), ...reviews.map((d) => d.salonId)]);
    const pros = await this.prisma.user.findMany({ where: { id: { in: [...ids] }, role: { in: [...PRO_ROLES] } }, select: { id: true } });
    for (const { id } of pros) {
      const d = done.find((x) => x.userId === id)?._count._all ?? 0;
      const u = upcoming.find((x) => x.userId === id)?._count._all ?? 0;
      const r = reviews.find((x) => x.salonId === id)?._count._all ?? 0;
      const parts = [plural(d, 'rendez-vous réalisé', 'rendez-vous réalisés'), `${u} à venir cette semaine`, r ? plural(r, 'nouvel avis', 'nouveaux avis') : ''].filter(Boolean);
      await this.notifications.notify({
        userId: id, type: 'account.weekly_report', title: 'Votre semaine en un coup d’œil', body: parts.join(' · '), dedupeKey: `weekly:${p.date}`,
      });
    }
  }
}
