import { GiveawayStatus } from '@prisma/client';
import { parisDate } from '../residencies/presence';

export const SUPPORTED_TIMEZONES = ['Europe/Paris'] as const;

/** Instant UTC d'une heure murale à Paris (`date` = AAAA-MM-JJ). */
export function parisInstant(date: string, hour: number, minute: number, second = 0, ms = 0): Date {
  const base = parisDate(date, hour * 60 + minute);
  return new Date(base.getTime() + second * 1000 + ms);
}

type Timed = { status: GiveawayStatus; opensAt: Date; closesAt: Date };

/**
 * Statut effectif : SCHEDULED / ACTIVE sont déduits du calendrier pour un
 * concours publié ; un concours dont la date de fin est passée mais qui n'est
 * pas encore figé est présenté comme CLOSED.
 */
export function effectiveStatus(g: Timed, now = new Date()): GiveawayStatus {
  if (g.status !== GiveawayStatus.SCHEDULED && g.status !== GiveawayStatus.ACTIVE) return g.status;
  if (now < g.opensAt) return GiveawayStatus.SCHEDULED;
  if (now <= g.closesAt) return GiveawayStatus.ACTIVE;
  return GiveawayStatus.CLOSED;
}

/** Les participations sont ouvertes de `opensAt` à `closesAt` inclus. */
export function entriesOpen(g: Timed, now = new Date()): boolean {
  return effectiveStatus(g, now) === GiveawayStatus.ACTIVE;
}

/** Les éléments substantiels (lots, règles, calendrier) sont verrouillés dès l'ouverture d'un concours publié. */
export function substantialLocked(g: Timed & { publishedAt: Date | null }, now = new Date()): boolean {
  if (!g.publishedAt) return false;
  return g.status !== GiveawayStatus.SCHEDULED || now >= g.opensAt;
}
