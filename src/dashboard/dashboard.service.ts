import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { ClientsService } from '../clients/clients.service';
import { ConversationsService } from '../messaging/conversations/conversations.service';
import { SalonReviewService } from '../salon-review/salon-review.service';
import { SuiviService } from '../suivi/suivi.service';
import { SaasService } from '../saas/saas.service';
import { findUnansweredFollowUps } from '../follow-up/unanswered-follow-ups';

/** Résultat d'un bloc : une erreur dans un bloc (ex. plan FREE) n'empêche jamais les autres. */
export type DashboardSection<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

export type DashboardSummaryParams = {
  /** Jour des rendez-vous (YYYY-MM-DD). Défaut : aujourd'hui. */
  date?: string;
  /** Période du taux de remplissage (ISO). Défaut : semaine en cours. */
  fillStart?: string;
  fillEnd?: string;
  /** Mois / année des chiffres mensuels. Défaut : mois en cours. */
  month?: number;
  year?: number;
};

export const DASHBOARD_SECTIONS = [
  'today', 'pending', 'conversations', 'followUps', 'drawingCards',
  'fillRate', 'cancelRate', 'newClients', 'paid', 'recentReviews',
] as const;
export type DashboardSectionName = (typeof DASHBOARD_SECTIONS)[number];

/** Blocs réservés aux offres payantes (équivalent de `@SaasLimit('dashboard')` sur les routes d'origine). */
const RESTRICTED: DashboardSectionName[] = ['today', 'fillRate', 'cancelRate', 'newClients', 'paid'];

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appointments: AppointmentsService,
    private readonly clients: ClientsService,
    private readonly conversations: ConversationsService,
    private readonly reviews: SalonReviewService,
    private readonly drawing: SuiviService,
    private readonly saas: SaasService,
  ) {}

  /** Semaine en cours, du lundi 00:00 au dimanche 23:59:59.999 (UTC). */
  private currentWeek(): { start: string; end: string } {
    const now = new Date();
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7)));
    const sunday = new Date(monday.getTime() + 7 * 86_400_000 - 1);
    return { start: monday.toISOString(), end: sunday.toISOString() };
  }

  private async guard<T>(run: () => Promise<T>): Promise<DashboardSection<T>> {
    try {
      return { ok: true, data: await run() };
    } catch (e) {
      const status = typeof (e as { getStatus?: () => number })?.getStatus === 'function' ? (e as { getStatus: () => number }).getStatus() : 500;
      const message = e instanceof Error ? e.message : 'Une erreur est survenue.';
      return { ok: false, status, message };
    }
  }

  /**
   * Toutes les données de l'accueil en une réponse. Les requêtes partent en parallèle et chaque bloc réussit ou échoue seul.
   * `sections` limite la réponse à certains blocs (tous par défaut).
   */
  async summary(userId: string, params: DashboardSummaryParams = {}, sections?: DashboardSectionName[]) {
    const wanted = new Set<DashboardSectionName>(sections?.length ? sections : DASHBOARD_SECTIONS);
    const now = new Date();
    const month = params.month && params.month >= 1 && params.month <= 12 ? Math.trunc(params.month) : now.getUTCMonth() + 1;
    const year = params.year && params.year > 2000 ? Math.trunc(params.year) : now.getUTCFullYear();
    const week = this.currentWeek();
    const fillStart = params.fillStart || week.start;
    const fillEnd = params.fillEnd || week.end;

    // Droit d'accès aux statistiques : vérifié une seule fois pour tous les blocs concernés.
    let restrictedError: { status: number; message: string } | null = null;
    if (RESTRICTED.some((s) => wanted.has(s))) {
      try {
        await this.saas.enforceSaasAccess(userId, 'dashboard');
      } catch (e) {
        restrictedError = {
          status: typeof (e as { getStatus?: () => number })?.getStatus === 'function' ? (e as { getStatus: () => number }).getStatus() : 403,
          message: e instanceof Error ? e.message : 'Accès aux statistiques refusé.',
        };
      }
    }

    const tasks: Record<DashboardSectionName, () => Promise<unknown>> = {
      today: () => this.appointments.getTodaysAppointments(userId, params.date),
      pending: () => this.appointments.getPendingAppointments(userId),
      conversations: () => this.conversations.getConversationsWithUnreadMessages(userId),
      followUps: async () => ({ followUps: await findUnansweredFollowUps(this.prisma, userId) }),
      drawingCards: () => this.drawing.getCards(userId, {}),
      fillRate: () => this.appointments.getWeeklyFillRate(userId, fillStart, fillEnd),
      cancelRate: () => this.appointments.getGlobalCancellationRate(userId),
      newClients: () => this.clients.getNewClientsCountByMonth(userId, month, year),
      paid: () => this.appointments.getTotalPaidAppointmentsByMonth(userId, month, year),
      recentReviews: () => this.reviews.getRecentReviewsBySalon(userId, 5),
    };

    const names = DASHBOARD_SECTIONS.filter((s) => wanted.has(s));
    const results = await Promise.all(
      names.map((name): Promise<DashboardSection<unknown>> =>
        restrictedError && RESTRICTED.includes(name)
          ? Promise.resolve({ ok: false, status: restrictedError.status, message: restrictedError.message })
          : this.guard(tasks[name]),
      ),
    );

    return Object.fromEntries(names.map((name, i) => [name, results[i]])) as Partial<Record<DashboardSectionName, DashboardSection<unknown>>>;
  }
}
