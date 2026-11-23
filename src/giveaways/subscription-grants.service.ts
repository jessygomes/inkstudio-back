import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  Prisma,
  SaasPlan,
  SaasPlanStatus,
  SubscriptionGrant,
  SubscriptionGrantMode,
  SubscriptionGrantStatus,
} from '@prisma/client';
import { invitationEndDate } from '../auth/invitation-policy';
import { PrismaService } from '../database/prisma.service';
import { CacheService } from '../redis/cache.service';
import { SaasService } from '../saas/saas.service';
import { StripeService } from '../stripe/stripe.service';

/**
 * Abonnements offerts (lots de concours, et toute autre origine future).
 *
 * Choix d'architecture (voir docs/giveaways.md) :
 * - Compte SANS abonnement Stripe : droit applicatif uniquement (`User.saasPlan`
 *   + `SaasPlanDetails`, `paymentMethod = 'GIVEAWAY'`), exactement comme les
 *   offres admin et invitations existantes. Aucun objet Stripe n'est créé, donc
 *   ni carte, ni facture, ni renouvellement. À la fin, la tâche horaire
 *   existante (`downgradeExpiredInvitationUsers`) repasse le compte en FREE.
 * - Compte AVEC abonnement Stripe : on réutilise le mécanisme admin déjà en
 *   production (`StripeService.applyAdminGift`) qui repousse `trial_end` à la
 *   fin de la période déjà payée + N mois : aucune facture pendant l'offre, la
 *   période payée est conservée, et l'abonnement reprend ensuite aux conditions
 *   que l'abonné avait lui-même acceptées. Les webhooks reconnaissent ce cadeau
 *   (`readStripeAdminGift`) et ne l'écrasent pas.
 * - Toute mutation Stripe exige `GIVEAWAY_STRIPE_GRANTS` (off par défaut) et la
 *   confirmation de l'aperçu calculé juste avant (hash).
 */

export const GRANT_PAYMENT_METHOD = 'GIVEAWAY';
/** Droits gratuits sans Stripe à la suite desquels un lot peut être chaîné. */
const FREE_ENTITLEMENT_METHODS = ['INVITATION', 'ADMIN_GIFT', GRANT_PAYMENT_METHOD];
const RANK: Record<SaasPlan, number> = { FREE: 0, PRO: 1, BUSINESS: 2 };

export type CurrentEntitlement = {
  plan: SaasPlan;
  planStatus: SaasPlanStatus | null;
  endDate: Date | null;
  trialEndDate: Date | null;
  paymentMethod: string | null;
};

export type AppGrantPlan = {
  mode: 'APP_ENTITLEMENT';
  plan: SaasPlan;
  startsAt: Date;
  endsAt: Date;
  deferred: boolean;
  previous: { plan: SaasPlan; endDate: Date | null; paymentMethod: string | null };
};

/**
 * Calcule l'application d'un abonnement offert à un compte sans Stripe.
 * - rien d'actif → commence maintenant ;
 * - même formule offerte en cours (essai natif, invitation, offre admin, autre lot) → commence à sa fin (chaînage, aucun jour perdu) ;
 * - formule inférieure en cours → passage immédiat à la formule offerte (refus si l'ancienne allait au-delà) ;
 * - formule supérieure en cours, ou formule payante sans date de fin → refus (traitement manuel).
 */
export function planAppGrant(current: CurrentEntitlement | null, plan: SaasPlan, months: number, now = new Date()): AppGrantPlan {
  if (plan === SaasPlan.FREE) throw new BadRequestException('Un abonnement offert doit être PRO ou BUSINESS.');
  if (!Number.isSafeInteger(months) || months < 1 || months > 36) throw new BadRequestException('Durée invalide (1 à 36 mois).');
  const previous = { plan: current?.plan ?? SaasPlan.FREE, endDate: current?.endDate ?? null, paymentMethod: current?.paymentMethod ?? null };
  let currentEnd: Date | null = null;
  if (current && current.plan !== SaasPlan.FREE) {
    const trialEnd = current.planStatus === SaasPlanStatus.TRIAL ? current.trialEndDate : null;
    const end = trialEnd ?? current.endDate;
    if (!end) throw new ConflictException('Le compte a une formule payante sans date de fin connue : traitement manuel requis.');
    if (end > now) {
      const known = trialEnd !== null || current.paymentMethod === null || FREE_ENTITLEMENT_METHODS.includes(current.paymentMethod);
      if (!known) throw new ConflictException(`Formule en cours d'origine inconnue (${current.paymentMethod}) : traitement manuel requis.`);
      currentEnd = end;
    }
  }
  if (!currentEnd) {
    return { mode: 'APP_ENTITLEMENT', plan, startsAt: now, endsAt: invitationEndDate(now, months), deferred: false, previous };
  }
  const currentRank = RANK[current!.plan];
  if (RANK[plan] === currentRank) {
    return { mode: 'APP_ENTITLEMENT', plan, startsAt: currentEnd, endsAt: invitationEndDate(currentEnd, months), deferred: true, previous };
  }
  if (RANK[plan] > currentRank) {
    const endsAt = invitationEndDate(now, months);
    if (currentEnd > endsAt)
      throw new ConflictException('La formule inférieure en cours dure plus longtemps que le lot : traitement manuel requis pour ne rien faire perdre.');
    return { mode: 'APP_ENTITLEMENT', plan, startsAt: now, endsAt, deferred: false, previous };
  }
  throw new ConflictException('Le compte a déjà une formule supérieure en cours : traitement manuel requis.');
}

export type GrantPreview =
  | AppGrantPlan
  | {
      mode: 'STRIPE_TRIAL_EXTENSION';
      plan: SaasPlan;
      startsAt: Date;
      endsAt: Date;
      deferred: true;
      stripe: { amount: number; currency: string; interval: string; intervalCount: number; confirmation: string; requestId: string };
    };

export type ApplyGrantInput = {
  userId: string;
  plan: SaasPlan;
  durationMonths: number;
  source: string;
  actorId: string;
  idempotencyKey: string;
  awardId?: string;
  confirmation?: string;
  requestId?: string;
};

type Tx = Prisma.TransactionClient;

@Injectable()
export class SubscriptionGrantsService {
  private readonly logger = new Logger(SubscriptionGrantsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly saas: SaasService,
    private readonly cache: CacheService,
    @Optional() private readonly stripe?: StripeService,
  ) {}

  /** Mode d'écriture Stripe autorisé : off (défaut), test (clé sk_test_/rk_test_ uniquement) ou live. */
  static stripeWritesAllowed(env = process.env): boolean {
    const mode = (env.GIVEAWAY_STRIPE_GRANTS || 'off').trim().toLowerCase();
    const key = (env.STRIPE_SECRET_KEY || '').trim().replace(/^['"]|['"]$/g, '');
    if (mode === 'live') return true;
    if (mode === 'test') return /^(sk|rk)_test_/.test(key);
    return false;
  }

  private assertPlanForRole(role: string, plan: SaasPlan) {
    if (plan === SaasPlan.BUSINESS && role !== 'user_salon')
      throw new BadRequestException('Le plan Business est réservé aux comptes salon.');
    if (!['user_salon', 'user_tatoueur', 'user'].includes(role))
      throw new BadRequestException('Seuls les comptes professionnels peuvent recevoir un abonnement.');
  }

  private async loadAccount(userId: string, db: Tx | PrismaService = this.prisma) {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, saasPlan: true, stripeSubscriptionId: true, saasPlanDetails: true },
    });
    if (!user) throw new NotFoundException('Compte introuvable.');
    return user;
  }

  private current(user: Awaited<ReturnType<SubscriptionGrantsService['loadAccount']>>): CurrentEntitlement | null {
    const d = user.saasPlanDetails;
    if (!d) return user.saasPlan === SaasPlan.FREE ? null : { plan: user.saasPlan, planStatus: null, endDate: null, trialEndDate: null, paymentMethod: null };
    return { plan: d.currentPlan, planStatus: d.planStatus, endDate: d.endDate, trialEndDate: d.trialEndDate, paymentMethod: d.paymentMethod };
  }

  /** Aperçu sans aucune écriture (pour un abonné Stripe : une seule lecture de l'abonnement chez Stripe). */
  async preview(userId: string, plan: SaasPlan, durationMonths: number, now = new Date()): Promise<GrantPreview> {
    const user = await this.loadAccount(userId);
    this.assertPlanForRole(user.role, plan);
    if (!user.stripeSubscriptionId) return planAppGrant(this.current(user), plan, durationMonths, now);
    if (user.saasPlanDetails?.paymentMethod === 'STRIPE_GIFT')
      throw new ConflictException('Ce compte a déjà une période offerte programmée dans Stripe : traitement manuel requis.');
    if (!this.stripe) throw new BadRequestException('Service Stripe indisponible.');
    const p = await this.stripe.previewAdminGift(userId, durationMonths, 'MONTHS');
    if (p.currentPlan !== plan)
      throw new ConflictException(`L'abonnement Stripe (${p.currentPlan}) ne correspond pas au lot (${plan}) : traitement manuel requis.`);
    return {
      mode: 'STRIPE_TRIAL_EXTENSION',
      plan,
      startsAt: new Date(p.startDate),
      endsAt: new Date(p.endDate),
      deferred: true,
      stripe: { amount: p.amount, currency: p.currency, interval: p.interval, intervalCount: p.intervalCount, confirmation: p.confirmation, requestId: p.requestId },
    };
  }

  /** Idempotent : la même clé renvoie toujours le même abonnement offert. */
  async apply(input: ApplyGrantInput, now = new Date()): Promise<{ grant: SubscriptionGrant; created: boolean }> {
    const existing = await this.prisma.subscriptionGrant.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return { grant: existing, created: false };
    const user = await this.loadAccount(input.userId);
    this.assertPlanForRole(user.role, input.plan);
    const grant = user.stripeSubscriptionId ? await this.applyStripe(input, user) : await this.applyApp(input, now);
    await this.cache.delPattern('user:*').catch(() => undefined);
    await this.cache.delPattern('admin:*').catch(() => undefined);
    this.logger.log(JSON.stringify({ event: 'subscription-grant.applied', grantId: grant.id, userId: input.userId, mode: grant.mode, plan: grant.plan, source: input.source }));
    return { grant, created: true };
  }

  private async applyApp(input: ApplyGrantInput, now: Date) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Sérialise toutes les attributions sur ce compte.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`subscription-grant:${input.userId}`}))`;
        const again = await tx.subscriptionGrant.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
        if (again) return again;
        const user = await this.loadAccount(input.userId, tx);
        if (user.stripeSubscriptionId) throw new ConflictException('Un abonnement Stripe vient d’être rattaché au compte : rechargez l’aperçu.');
        const plan = planAppGrant(this.current(user), input.plan, input.durationMonths, now);
        // Écriture conditionnelle : échoue si un abonnement Stripe apparaît entre-temps.
        const locked = await tx.user.updateMany({
          where: { id: input.userId, stripeSubscriptionId: null },
          data: { saasPlan: plan.plan, saasPlanUntil: plan.endsAt },
        });
        if (!locked.count) throw new ConflictException('Le compte a changé : rechargez l’aperçu.');
        const details = {
          ...this.saas.getPlanConfiguration(plan.plan),
          currentPlan: plan.plan,
          planStatus: SaasPlanStatus.ACTIVE,
          endDate: plan.endsAt,
          trialEndDate: null,
          nextPaymentDate: null,
          pastDueSince: null,
          monthlyPrice: 0,
          yearlyPrice: 0,
          paymentMethod: GRANT_PAYMENT_METHOD,
        };
        await tx.saasPlanDetails.upsert({
          where: { userId: input.userId },
          update: { ...details, ...(plan.deferred ? {} : { startDate: plan.startsAt }) },
          create: { ...details, userId: input.userId, startDate: plan.startsAt },
        });
        return tx.subscriptionGrant.create({
          data: {
            userId: input.userId,
            awardId: input.awardId ?? null,
            source: input.source,
            plan: plan.plan,
            durationMonths: input.durationMonths,
            mode: SubscriptionGrantMode.APP_ENTITLEMENT,
            startsAt: plan.startsAt,
            endsAt: plan.endsAt,
            previousPlan: plan.previous.plan,
            previousEndDate: plan.previous.endDate,
            previousPaymentMethod: plan.previous.paymentMethod,
            idempotencyKey: input.idempotencyKey,
            createdById: input.actorId,
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const grant = await this.prisma.subscriptionGrant.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
        if (grant) return grant;
        throw new ConflictException('Ce lot a déjà été attribué.');
      }
      throw error;
    }
  }

  private async applyStripe(input: ApplyGrantInput, user: Awaited<ReturnType<SubscriptionGrantsService['loadAccount']>>) {
    if (!SubscriptionGrantsService.stripeWritesAllowed())
      throw new ForbiddenException(
        'Ce gagnant a un abonnement Stripe : l’attribution automatique est désactivée (GIVEAWAY_STRIPE_GRANTS). Suivez la procédure manuelle de docs/giveaways.md.',
      );
    if (!this.stripe) throw new BadRequestException('Service Stripe indisponible.');
    if (!input.confirmation || !input.requestId)
      throw new BadRequestException('Affichez l’aperçu Stripe puis confirmez-le (confirmation et requestId requis).');
    if (user.saasPlanDetails?.paymentMethod === 'STRIPE_GIFT')
      throw new ConflictException('Ce compte a déjà une période offerte programmée dans Stripe : traitement manuel requis.');
    // Idempotent côté Stripe (clé `admin-gift:<user>:<requestId>`), et la confirmation garantit que rien n'a changé depuis l'aperçu.
    const gift = await this.stripe.applyAdminGift(input.userId, input.durationMonths, 'MONTHS', input.confirmation, input.requestId, input.actorId, input.source);
    if (gift.currentPlan !== input.plan)
      throw new ConflictException('La formule Stripe ne correspond pas au lot.');
    await this.saas.markStripeGift(input.userId, gift.currentPlan as SaasPlan, gift.startDate, gift.endDate, gift.autoResume);
    try {
      return await this.prisma.subscriptionGrant.create({
        data: {
          userId: input.userId,
          awardId: input.awardId ?? null,
          source: input.source,
          plan: input.plan,
          durationMonths: input.durationMonths,
          mode: SubscriptionGrantMode.STRIPE_TRIAL_EXTENSION,
          startsAt: gift.startDate,
          endsAt: gift.endDate,
          previousPlan: user.saasPlanDetails?.currentPlan ?? user.saasPlan,
          previousPaymentMethod: user.saasPlanDetails?.paymentMethod ?? null,
          previousEndDate: user.saasPlanDetails?.endDate ?? null,
          stripeSubscriptionId: user.stripeSubscriptionId,
          stripeRequestId: input.requestId,
          idempotencyKey: input.idempotencyKey,
          createdById: input.actorId,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const grant = await this.prisma.subscriptionGrant.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
        if (grant) return grant;
      }
      throw error;
    }
  }

  /**
   * Annule un abonnement offert applicatif. Le droit n'est retiré que s'il est
   * encore celui posé par ce lot ; sinon (abonnement souscrit depuis, autre
   * offre…) seul le lot est marqué annulé. Un lot Stripe s'annule à la main.
   */
  async cancel(grantId: string, actorId: string, reason: string, now = new Date()) {
    const grant = await this.prisma.subscriptionGrant.findUnique({ where: { id: grantId } });
    if (!grant) throw new NotFoundException('Abonnement offert introuvable.');
    if (grant.status === SubscriptionGrantStatus.CANCELLED) return { grant, entitlementReverted: false };
    if (grant.mode === SubscriptionGrantMode.STRIPE_TRIAL_EXTENSION)
      throw new ConflictException('Lot programmé dans Stripe : annulation manuelle (voir docs/giveaways.md), puis marquez le lot annulé.');
    const result = await this.prisma.$transaction(async (tx) => {
      let reverted = false;
      if (grant.userId) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`subscription-grant:${grant.userId}`}))`;
        const user = await this.loadAccount(grant.userId, tx).catch(() => null);
        const d = user?.saasPlanDetails;
        const stillOurs =
          user && !user.stripeSubscriptionId && d?.paymentMethod === GRANT_PAYMENT_METHOD && d.endDate?.getTime() === grant.endsAt.getTime();
        if (stillOurs) {
          const restore = grant.previousEndDate && grant.previousEndDate > now && grant.previousPlan && grant.previousPlan !== SaasPlan.FREE;
          const plan = restore ? grant.previousPlan! : SaasPlan.FREE;
          const endDate = restore ? grant.previousEndDate : null;
          await tx.user.update({ where: { id: grant.userId }, data: { saasPlan: plan, saasPlanUntil: endDate } });
          await tx.saasPlanDetails.update({
            where: { userId: grant.userId },
            data: {
              ...this.saas.getPlanConfiguration(plan),
              currentPlan: plan,
              planStatus: restore ? SaasPlanStatus.ACTIVE : SaasPlanStatus.EXPIRED,
              endDate,
              paymentMethod: restore ? grant.previousPaymentMethod : (d?.paymentMethod ?? null),
              monthlyPrice: 0,
              yearlyPrice: 0,
            },
          });
          reverted = true;
        }
      }
      const updated = await tx.subscriptionGrant.update({
        where: { id: grant.id },
        data: { status: SubscriptionGrantStatus.CANCELLED, cancelledAt: now, cancelledById: actorId, cancelReason: reason.slice(0, 500) },
      });
      return { grant: updated, entitlementReverted: reverted };
    });
    await this.cache.delPattern('user:*').catch(() => undefined);
    return result;
  }

  /** État lisible (l'expiration est déduite des dates ; le droit lui-même est retiré par la tâche horaire existante). */
  static effectiveStatus(grant: Pick<SubscriptionGrant, 'status' | 'startsAt' | 'endsAt'>, now = new Date()) {
    if (grant.status === SubscriptionGrantStatus.CANCELLED) return 'CANCELLED';
    if (now < grant.startsAt) return 'SCHEDULED';
    if (now < grant.endsAt) return 'ACTIVE';
    return 'EXPIRED';
  }
}
