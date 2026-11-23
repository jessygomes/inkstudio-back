import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  Giveaway,
  GiveawayAwardStatus,
  GiveawayCategory,
  GiveawayEntryStatus,
  GiveawayPrize,
  GiveawayStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { publicDisplayName } from '../user/public-profile.utils';
import { GiveawayAuditService } from './giveaway-audit.service';
import { GiveawayEligibilityService } from './giveaway-eligibility.service';
import { acceptanceEmail, entryConfirmationEmail } from './giveaway-emails';
import { GiveawayMailerService } from './giveaway-mailer.service';
import { readConfig } from './giveaway-definition';
import { participantHash } from './giveaway-profile';
import { effectiveStatus, entriesOpen } from './giveaway-time';

type FullGiveaway = Giveaway & { categories: (GiveawayCategory & { prizes: GiveawayPrize[] })[] };

export const giveawayInclude = {
  categories: { orderBy: { sortOrder: 'asc' as const }, include: { prizes: { orderBy: { createdAt: 'asc' as const } } } },
};

/** Raisons d'invalidité affichables au participant (jamais le détail d'une autre participation). */
const PUBLIC_INVALID_REASONS: Record<string, string> = {
  INELIGIBLE_AT_CLOSE: 'Votre profil ne remplissait plus les conditions à la clôture.',
  DUPLICATE_ACCOUNT: 'Une autre participation a été retenue pour la même personne ou le même établissement.',
  RULES_VIOLATION: 'Participation non conforme au règlement.',
};

export function studioGiveawayUrl(slug: string) {
  const base = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
  return `${base}/concours/${encodeURIComponent(slug)}`;
}

export function publicGiveaway(g: FullGiveaway, now = new Date()) {
  const config = readConfig(g.config);
  return {
    slug: g.slug,
    title: g.title,
    description: g.description,
    status: effectiveStatus(g, now),
    entriesOpen: entriesOpen(g, now) && !!g.rulesApprovedAt,
    opensAt: g.opensAt,
    closesAt: g.closesAt,
    drawAt: g.drawAt,
    timezone: g.timezone,
    rulesVersion: g.rulesVersion,
    rulesUrl: g.rulesUrl,
    resultsPublished: !!g.resultsPublishedAt,
    coverImageUrl: config.coverImageUrl,
    categories: g.categories.map((c) => ({
      key: c.key,
      label: c.label,
      description: c.description,
      winnersCount: c.winnersCount,
      requirements: c.criteria,
      prizes: c.prizes.map((p) => ({
        type: p.type,
        label: p.label,
        plan: p.plan,
        durationMonths: p.durationMonths,
        quantity: p.quantity,
        commercialValueCents: config.showPrizeValue ? p.commercialValueCents : null,
        currency: p.currency,
      })),
    })),
  };
}

@Injectable()
export class GiveawaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eligibility: GiveawayEligibilityService,
    private readonly mailer: GiveawayMailerService,
    private readonly audit: GiveawayAuditService,
  ) {}

  /** Concours visibles : publiés, non archivés. */
  private async findPublished(slug: string): Promise<FullGiveaway> {
    const g = await this.prisma.giveaway.findUnique({ where: { slug }, include: giveawayInclude });
    if (!g || !g.publishedAt || g.archivedAt || g.status === GiveawayStatus.DRAFT) throw new NotFoundException('Concours introuvable.');
    return g;
  }

  async list(now = new Date()) {
    const items = await this.prisma.giveaway.findMany({
      where: { publishedAt: { not: null }, archivedAt: null, status: { notIn: [GiveawayStatus.DRAFT, GiveawayStatus.CANCELLED] } },
      include: giveawayInclude,
      orderBy: { opensAt: 'desc' },
      take: 50,
    });
    return items.map((g) => publicGiveaway(g, now));
  }

  async detail(slug: string, now = new Date()) {
    return publicGiveaway(await this.findPublished(slug), now);
  }

  async rules(slug: string) {
    const g = await this.findPublished(slug);
    return { version: g.rulesVersion, hash: g.rulesHash, url: g.rulesUrl, content: g.rulesContent, approved: !!g.rulesApprovedAt };
  }

  async eligibilityFor(slug: string, userId: string, now = new Date()) {
    const g = await this.findPublished(slug);
    const [{ result }, entry] = await Promise.all([
      this.eligibility.check(userId, g.categories),
      this.prisma.giveawayEntry.findUnique({ where: { giveawayId_userId: { giveawayId: g.id, userId } }, select: { id: true, status: true } }),
    ]);
    return { ...result, entriesOpen: entriesOpen(g, now) && !!g.rulesApprovedAt, alreadyEntered: !!entry, rulesVersion: g.rulesVersion };
  }

  private entryView(g: Giveaway, entry: Prisma.GiveawayEntryGetPayload<{ include: { category: true } }>) {
    return {
      id: entry.id,
      status: entry.status === GiveawayEntryStatus.PENDING_REVIEW ? 'UNDER_REVIEW' : entry.status,
      category: { key: entry.category.key, label: entry.category.label },
      createdAt: entry.createdAt,
      acceptedRulesAt: entry.acceptedRulesAt,
      rulesVersion: entry.rulesVersion,
      rulesUpdatedSinceEntry: entry.rulesVersion < g.rulesVersion,
      invalidReason:
        entry.status === GiveawayEntryStatus.INVALID
          ? PUBLIC_INVALID_REASONS[entry.invalidReason ?? ''] ?? 'Participation non retenue.'
          : null,
    };
  }

  async myEntry(slug: string, userId: string) {
    const g = await this.findPublished(slug);
    const entry = await this.prisma.giveawayEntry.findUnique({
      where: { giveawayId_userId: { giveawayId: g.id, userId } },
      include: { category: true },
    });
    if (!entry) return { entry: null, award: null };
    const award = await this.prisma.giveawayAward.findFirst({
      where: { entryId: entry.id, status: { not: GiveawayAwardStatus.PENDING_CONFIRMATION } },
      include: { prize: true },
      orderBy: { createdAt: 'desc' },
    });
    return { entry: this.entryView(g, entry), award: award ? this.awardView(award) : null };
  }

  private awardView(a: Prisma.GiveawayAwardGetPayload<{ include: { prize: true } }>) {
    return {
      id: a.id,
      status: a.status,
      prize: { label: a.prize.label, plan: a.prize.plan, durationMonths: a.prize.durationMonths },
      acceptDeadline: a.acceptDeadline,
      acceptedAt: a.acceptedAt,
      publicationConsent: a.publicationConsent,
      activatedAt: a.activatedAt,
    };
  }

  /**
   * Participation : action explicite, règlement accepté côté serveur, éligibilité
   * vérifiée, idempotente (même réponse si l'on rejoue) et atomique (contrainte
   * unique concours + compte).
   */
  async enter(slug: string, userId: string, body: { acceptRules: boolean; rulesVersion: number }, now = new Date()) {
    if (body.acceptRules !== true) throw new BadRequestException('Vous devez accepter le règlement pour participer.');
    const g = await this.findPublished(slug);
    const existing = await this.prisma.giveawayEntry.findUnique({
      where: { giveawayId_userId: { giveawayId: g.id, userId } },
      include: { category: true },
    });
    if (existing) return { created: false, entry: this.entryView(g, existing) };
    if (!entriesOpen(g, now)) throw new ForbiddenException({ code: 'GIVEAWAY_NOT_OPEN', message: 'Les participations ne sont pas ouvertes.' });
    if (!g.rulesApprovedAt) throw new ForbiddenException({ code: 'GIVEAWAY_NOT_OPEN', message: 'Les participations ne sont pas ouvertes.' });
    if (body.rulesVersion !== g.rulesVersion)
      throw new ConflictException({ code: 'RULES_VERSION_CHANGED', message: 'Le règlement a été mis à jour : relisez-le avant de participer.', rulesVersion: g.rulesVersion });

    const { result, user, signals } = await this.eligibility.check(userId, g.categories);
    if (!result.eligible || !result.category || !user)
      throw new UnprocessableEntityException({ code: 'NOT_ELIGIBLE', message: 'Votre profil ne remplit pas encore les conditions.', eligibility: result });

    const duplicates = signals.length
      ? await this.prisma.giveawayEntry.findMany({
          where: {
            giveawayId: g.id,
            userId: { not: userId },
            identitySignals: { hasSome: signals },
            status: { in: [GiveawayEntryStatus.VALID, GiveawayEntryStatus.PENDING_REVIEW] },
          },
          select: { id: true },
          take: 20,
        })
      : [];

    let entry: Prisma.GiveawayEntryGetPayload<{ include: { category: true } }>;
    try {
      entry = await this.prisma.giveawayEntry.create({
        data: {
          giveawayId: g.id,
          categoryId: result.category.id,
          userId,
          participantHash: participantHash(userId),
          status: duplicates.length ? GiveawayEntryStatus.PENDING_REVIEW : GiveawayEntryStatus.VALID,
          acceptedRulesAt: now,
          rulesVersion: g.rulesVersion,
          rulesHash: g.rulesHash,
          eligibilityAtEntry: result as unknown as Prisma.InputJsonValue,
          identitySignals: signals,
          duplicateOfEntryIds: duplicates.map((d) => d.id),
        },
        include: { category: true },
      });
    } catch (error) {
      // Requête concurrente du même compte : la première a gagné, on renvoie sa participation.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await this.prisma.giveawayEntry.findUnique({
          where: { giveawayId_userId: { giveawayId: g.id, userId } },
          include: { category: true },
        });
        if (winner) return { created: false, entry: this.entryView(g, winner) };
      }
      throw error;
    }

    await this.audit.record({
      giveawayId: g.id,
      actorId: userId,
      action: 'entry.created',
      targetType: 'entry',
      targetId: entry.id,
      data: { categoryKey: result.category.key, rulesVersion: g.rulesVersion, flaggedForReview: duplicates.length > 0, matches: duplicates.length },
    });
    await this.mailer.sendOnce(
      `entry:${entry.id}:confirmation`,
      'entry-confirmation',
      user.email,
      entryConfirmationEmail({ name: publicDisplayName(user) || 'vous', title: g.title, url: studioGiveawayUrl(g.slug), drawAt: g.drawAt, rulesVersion: g.rulesVersion }),
      userId,
    );
    return { created: true, entry: this.entryView(g, entry) };
  }

  /** Retrait volontaire avant la clôture (droit d'opposition) : la trace d'acceptation est conservée pour l'audit. */
  async withdraw(slug: string, userId: string, now = new Date()) {
    const g = await this.findPublished(slug);
    if (g.frozenAt || now > g.closesAt) throw new ConflictException('La participation ne peut plus être retirée après la clôture.');
    const updated = await this.prisma.giveawayEntry.updateMany({
      where: { giveawayId: g.id, userId, status: { in: [GiveawayEntryStatus.VALID, GiveawayEntryStatus.PENDING_REVIEW] } },
      data: { status: GiveawayEntryStatus.WITHDRAWN, withdrawnAt: now },
    });
    if (!updated.count) throw new NotFoundException('Aucune participation active.');
    await this.audit.record({ giveawayId: g.id, actorId: userId, action: 'entry.withdrawn' });
    return { success: true };
  }

  private async myAwardOrThrow(slug: string, userId: string) {
    const g = await this.findPublished(slug);
    const award = await this.prisma.giveawayAward.findFirst({
      where: { giveawayId: g.id, userId, status: { not: GiveawayAwardStatus.PENDING_CONFIRMATION } },
      include: { prize: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!award) throw new NotFoundException('Aucun lot à votre nom.');
    return { g, award };
  }

  async acceptAward(slug: string, userId: string, publicationConsent: boolean, now = new Date()) {
    const { g, award } = await this.myAwardOrThrow(slug, userId);
    if (award.status === GiveawayAwardStatus.ACCEPTED || award.status === GiveawayAwardStatus.ACTIVATED)
      return { award: this.awardView(award) };
    if (award.status !== GiveawayAwardStatus.CONFIRMED) throw new ConflictException('Ce lot ne peut plus être accepté.');
    if (award.acceptDeadline && now > award.acceptDeadline)
      throw new ConflictException({ code: 'ACCEPTANCE_EXPIRED', message: 'Le délai pour accepter ce lot est dépassé.' });
    const updated = await this.prisma.giveawayAward.updateMany({
      where: { id: award.id, status: GiveawayAwardStatus.CONFIRMED },
      data: { status: GiveawayAwardStatus.ACCEPTED, acceptedAt: now, publicationConsent, publicationConsentAt: now },
    });
    const fresh = await this.prisma.giveawayAward.findUniqueOrThrow({ where: { id: award.id }, include: { prize: true } });
    if (updated.count) {
      await this.audit.record({ giveawayId: g.id, actorId: userId, action: 'award.accepted', targetType: 'award', targetId: award.id, data: { publicationConsent } });
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, salonName: true, firstName: true, lastName: true, nickname: true, role: true } });
      await this.mailer.sendOnce(`award:${award.id}:accepted`, 'award-accepted', user?.email, acceptanceEmail({ name: user ? publicDisplayName(user) : '', title: g.title, prize: fresh.prize.label }), userId);
    }
    return { award: this.awardView(fresh) };
  }

  async declineAward(slug: string, userId: string, now = new Date()) {
    const { g, award } = await this.myAwardOrThrow(slug, userId);
    if (award.status === GiveawayAwardStatus.DECLINED) return { award: this.awardView(award) };
    if (award.status !== GiveawayAwardStatus.CONFIRMED && award.status !== GiveawayAwardStatus.ACCEPTED)
      throw new ConflictException('Ce lot ne peut plus être refusé.');
    await this.prisma.giveawayAward.updateMany({
      where: { id: award.id, status: { in: [GiveawayAwardStatus.CONFIRMED, GiveawayAwardStatus.ACCEPTED] } },
      data: { status: GiveawayAwardStatus.DECLINED, declinedAt: now },
    });
    await this.audit.record({ giveawayId: g.id, actorId: userId, action: 'award.declined', targetType: 'award', targetId: award.id });
    return { award: this.awardView(await this.prisma.giveawayAward.findUniqueOrThrow({ where: { id: award.id }, include: { prize: true } })) };
  }

  /** Le gagnant peut changer d'avis sur la publication de son nom à tout moment. */
  async setPublicationConsent(slug: string, userId: string, consent: boolean, now = new Date()) {
    const { g, award } = await this.myAwardOrThrow(slug, userId);
    await this.prisma.giveawayAward.update({ where: { id: award.id }, data: { publicationConsent: consent, publicationConsentAt: now } });
    await this.audit.record({ giveawayId: g.id, actorId: userId, action: 'award.publication-consent', targetType: 'award', targetId: award.id, data: { consent } });
    return { publicationConsent: consent };
  }

  /** Résultats publiés uniquement ; un nom n'apparaît qu'avec le consentement du gagnant. */
  async results(slug: string) {
    const g = await this.findPublished(slug);
    if (!g.resultsPublishedAt) throw new NotFoundException('Les résultats ne sont pas encore publiés.');
    const draws = await this.prisma.giveawayDraw.findMany({
      where: { giveawayId: g.id, status: 'OFFICIAL' },
      include: { category: true },
    });
    const awardsByCategory = await this.prisma.giveawayAward.findMany({
      where: { giveawayId: g.id, status: { in: [GiveawayAwardStatus.ACCEPTED, GiveawayAwardStatus.ACTIVATED] } },
      include: { user: { select: { salonName: true, nickname: true, firstName: true, lastName: true, role: true, city: true } }, category: true },
      orderBy: { createdAt: 'asc' },
    });
    return {
      slug: g.slug,
      title: g.title,
      publishedAt: g.resultsPublishedAt,
      categories: draws
        .sort((a, b) => a.category.sortOrder - b.category.sortOrder)
        .map((d) => ({
          key: d.category.key,
          label: d.category.label,
          drawnAt: d.executedAt,
          eligibleCount: d.eligibleCount,
          algorithm: d.algorithm,
          snapshotHash: d.snapshotHash,
          seed: d.seedHex,
          winners: awardsByCategory
            .filter((a) => a.categoryId === d.categoryId)
            .map((a) =>
              a.publicationConsent && a.user
                ? { anonymous: false, displayName: publicDisplayName(a.user), city: a.user.city }
                : { anonymous: true, displayName: null, city: null },
            ),
        })),
    };
  }
}
