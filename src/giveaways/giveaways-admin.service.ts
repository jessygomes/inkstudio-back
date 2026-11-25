import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  GiveawayAwardStatus,
  GiveawayDrawRole,
  GiveawayDrawStatus,
  GiveawayEntryStatus,
  GiveawayPrizeType,
  GiveawayStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { publicDisplayName } from '../user/public-profile.utils';
import {
  ActivateAwardDto,
  AmendGiveawayDto,
  CreateGiveawayDto,
  DuplicateGiveawayDto,
  EntriesQueryDto,
  UpdateGiveawayDto,
} from './dto/giveaway.dto';
import { GiveawayAuditService } from './giveaway-audit.service';
import {
  CategoryInput,
  categoryCreateData,
  readConfig,
  rulesHash,
  validateDefinition,
} from './giveaway-definition';
import { DRAW_ALGORITHM, DrawSnapshot, newDrawSeed, runDraw, snapshotHash } from './giveaway-draw';
import { GiveawayEligibilityService } from './giveaway-eligibility.service';
import { activationEmail, adminNotificationEmail, alternateEmail, winnerEmail } from './giveaway-emails';
import { GiveawayMailerService } from './giveaway-mailer.service';
import { identitySignals } from './giveaway-profile';
import { effectiveStatus, substantialLocked } from './giveaway-time';
import { giveawayInclude, studioGiveawayUrl } from './giveaways.service';
import { SubscriptionGrantsService } from './subscription-grants.service';

const FINAL_AWARD: GiveawayAwardStatus[] = [
  GiveawayAwardStatus.ACTIVATED,
  GiveawayAwardStatus.DECLINED,
  GiveawayAwardStatus.FORFEITED,
  GiveawayAwardStatus.CANCELLED,
];
const RELEASED_AWARD: GiveawayAwardStatus[] = [
  GiveawayAwardStatus.DECLINED,
  GiveawayAwardStatus.FORFEITED,
  GiveawayAwardStatus.CANCELLED,
];
const nameSelect = { id: true, email: true, salonName: true, nickname: true, firstName: true, lastName: true, role: true, city: true } as const;

/** Neutralise l'injection de formules dans un tableur. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : value instanceof Date ? value.toISOString() : String(value as string | number | boolean);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

@Injectable()
export class GiveawaysAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eligibility: GiveawayEligibilityService,
    private readonly mailer: GiveawayMailerService,
    private readonly audit: GiveawayAuditService,
    private readonly grants: SubscriptionGrantsService,
  ) {}

  private async get(id: string) {
    const g = await this.prisma.giveaway.findUnique({ where: { id }, include: giveawayInclude });
    if (!g) throw new NotFoundException('Concours introuvable.');
    return g;
  }

  private assertConfirmation(given: string, expected: string) {
    if (given !== expected) throw new BadRequestException(`Confirmation incorrecte : saisissez « ${expected} ».`);
  }

  private async notifyAdmin(key: string, title: string, event: string, details: string[]) {
    await this.mailer.sendOnce(key, 'admin-notification', this.mailer.adminEmail(), adminNotificationEmail({ title, event, details }));
  }

  // ───────────────────────────── Lecture ─────────────────────────────

  async list(includeArchived = false, now = new Date()) {
    const items = await this.prisma.giveaway.findMany({
      where: includeArchived ? {} : { archivedAt: null },
      include: { _count: { select: { entries: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return items.map((g) => ({ ...g, effectiveStatus: effectiveStatus(g, now), locked: substantialLocked(g, now) }));
  }

  async detail(id: string, now = new Date()) {
    const g = await this.get(id);
    const [entries, draws] = await Promise.all([
      this.prisma.giveawayEntry.count({ where: { giveawayId: id } }),
      this.prisma.giveawayDraw.findMany({ where: { giveawayId: id }, select: { id: true, categoryId: true, status: true, executedAt: true }, orderBy: { executedAt: 'asc' } }),
    ]);
    return { ...g, effectiveStatus: effectiveStatus(g, now), locked: substantialLocked(g, now), entriesCount: entries, draws };
  }

  // ───────────────────────────── Création et édition ─────────────────────────────

  async create(dto: CreateGiveawayDto, actorId: string) {
    const opensAt = new Date(dto.opensAt);
    const closesAt = new Date(dto.closesAt);
    const drawAt = new Date(dto.drawAt);
    validateDefinition({ opensAt, closesAt, drawAt, categories: dto.categories as CategoryInput[] });
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const g = await tx.giveaway.create({
          data: {
            slug: dto.slug,
            title: dto.title,
            description: dto.description ?? null,
            opensAt,
            closesAt,
            drawAt,
            timezone: dto.timezone ?? 'Europe/Paris',
            rulesUrl: dto.rulesUrl ?? null,
            rulesContent: dto.rulesContent ?? null,
            rulesHash: rulesHash(dto.rulesContent, dto.rulesUrl),
            config: readConfig(dto.config as Prisma.JsonValue),
            createdById: actorId,
          },
        });
        await this.createCategories(tx, g.id, dto.categories as CategoryInput[]);
        return g;
      });
      await this.audit.record({ giveawayId: created.id, actorId, action: 'giveaway.created', data: { slug: dto.slug } });
      return this.get(created.id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Ce slug est déjà utilisé.');
      throw error;
    }
  }

  private async createCategories(tx: Prisma.TransactionClient, giveawayId: string, categories: CategoryInput[]) {
    for (const c of categoryCreateData(categories, giveawayId)) {
      const { prizes, ...category } = c;
      await tx.giveawayCategory.create({ data: { ...category, giveawayId, prizes: { create: prizes.map((p) => ({ ...p, giveawayId })) } } });
    }
  }

  async update(id: string, dto: UpdateGiveawayDto, actorId: string, now = new Date()) {
    const g = await this.get(id);
    if (g.status === GiveawayStatus.COMPLETED || g.status === GiveawayStatus.CANCELLED || g.archivedAt)
      throw new ConflictException('Ce concours n’est plus modifiable.');
    const slugChanged = dto.slug !== undefined && dto.slug !== g.slug;
    if (slugChanged && g.publishedAt)
      throw new ConflictException({ code: 'SLUG_LOCKED', message: 'L’adresse ne change plus après la publication : des liens et des e-mails l’utilisent déjà.' });
    const substantialKeys = ['opensAt', 'closesAt', 'drawAt', 'rulesUrl', 'rulesContent', 'categories'] as const;
    const touched = substantialKeys.filter((k) => dto[k] !== undefined);
    if (touched.length && substantialLocked(g, now))
      throw new ConflictException({
        code: 'GIVEAWAY_LOCKED',
        message: 'Concours ouvert : lots, règles et calendrier ne se modifient que par un avenant (POST …/amendments).',
        fields: touched,
      });
    const opensAt = dto.opensAt ? new Date(dto.opensAt) : g.opensAt;
    const closesAt = dto.closesAt ? new Date(dto.closesAt) : g.closesAt;
    const drawAt = dto.drawAt ? new Date(dto.drawAt) : g.drawAt;
    const categories: CategoryInput[] =
      (dto.categories as CategoryInput[] | undefined) ??
      g.categories.map((c) => ({ ...c, prizes: c.prizes.map((p) => ({ ...p })) }));
    validateDefinition({ opensAt, closesAt, drawAt, categories });
    if (dto.categories && (await this.prisma.giveawayEntry.count({ where: { giveawayId: id } })))
      throw new ConflictException('Des participations existent : les catégories ne peuvent plus être remplacées.');

    const rulesChanged =
      (dto.rulesContent !== undefined && dto.rulesContent !== g.rulesContent) || (dto.rulesUrl !== undefined && dto.rulesUrl !== g.rulesUrl);
    const nextContent = dto.rulesContent !== undefined ? dto.rulesContent : g.rulesContent;
    const nextUrl = dto.rulesUrl !== undefined ? dto.rulesUrl : g.rulesUrl;
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.giveaway.update({
          where: { id },
          data: {
            ...(slugChanged ? { slug: dto.slug } : {}),
            ...(dto.title !== undefined ? { title: dto.title } : {}),
            ...(dto.description !== undefined ? { description: dto.description } : {}),
            opensAt,
            closesAt,
            drawAt,
            // Fusion : un envoi partiel (ex. visuel seul) ne remet pas les autres réglages à leur valeur par défaut.
            ...(dto.config ? { config: readConfig({ ...readConfig(g.config), ...dto.config } as Prisma.JsonValue) } : {}),
            ...(rulesChanged
              ? {
                  rulesContent: nextContent,
                  rulesUrl: nextUrl,
                  rulesHash: rulesHash(nextContent, nextUrl),
                  // Tout changement de règlement doit être revalidé juridiquement ; une version publiée est incrémentée.
                  rulesApprovedAt: null,
                  rulesApprovedById: null,
                  rulesVersion: g.publishedAt ? g.rulesVersion + 1 : g.rulesVersion,
                }
              : {}),
            updatedById: actorId,
          },
        });
        if (dto.categories) {
          await tx.giveawayCategory.deleteMany({ where: { giveawayId: id } });
          await this.createCategories(tx, id, dto.categories as CategoryInput[]);
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Cette adresse est déjà utilisée par un autre concours.');
      throw error;
    }
    await this.audit.record({ giveawayId: id, actorId, action: 'giveaway.updated', data: { fields: Object.keys(dto), rulesChanged } });
    return this.get(id);
  }

  /** Validation juridique du règlement : condition de publication. */
  async approveRules(id: string, actorId: string, now = new Date()) {
    const g = await this.get(id);
    if (!g.rulesContent && !g.rulesUrl) throw new BadRequestException('Ajoutez le règlement (texte ou URL) avant de le valider.');
    await this.prisma.giveaway.update({ where: { id }, data: { rulesApprovedAt: now, rulesApprovedById: actorId } });
    await this.audit.record({ giveawayId: id, actorId, action: 'rules.approved', data: { version: g.rulesVersion, hash: g.rulesHash } });
    return this.get(id);
  }

  async publish(id: string, actorId: string, now = new Date()) {
    const g = await this.get(id);
    if (g.status !== GiveawayStatus.DRAFT) throw new ConflictException('Seul un brouillon peut être publié.');
    if (!g.rulesApprovedAt) throw new ConflictException({ code: 'RULES_NOT_APPROVED', message: 'Le règlement doit être validé avant publication.' });
    if (g.closesAt <= now) throw new ConflictException('La date de clôture est passée.');
    validateDefinition({ opensAt: g.opensAt, closesAt: g.closesAt, drawAt: g.drawAt, categories: g.categories as unknown as CategoryInput[] });
    const res = await this.prisma.giveaway.updateMany({
      where: { id, status: GiveawayStatus.DRAFT },
      data: { status: GiveawayStatus.SCHEDULED, publishedAt: now, updatedById: actorId },
    });
    if (!res.count) throw new ConflictException('Le concours a changé entre-temps.');
    await this.audit.record({ giveawayId: id, actorId, action: 'giveaway.published', data: { rulesVersion: g.rulesVersion } });
    return this.get(id);
  }

  async unpublish(id: string, actorId: string, now = new Date()) {
    const g = await this.get(id);
    if (g.status !== GiveawayStatus.SCHEDULED || now >= g.opensAt) throw new ConflictException('Seul un concours publié et pas encore ouvert peut repasser en brouillon.');
    if (await this.prisma.giveawayEntry.count({ where: { giveawayId: id } })) throw new ConflictException('Des participations existent.');
    await this.prisma.giveaway.update({ where: { id }, data: { status: GiveawayStatus.DRAFT, publishedAt: null, updatedById: actorId } });
    await this.audit.record({ giveawayId: id, actorId, action: 'giveaway.unpublished' });
    return this.get(id);
  }

  async archive(id: string, actorId: string, now = new Date()) {
    const g = await this.get(id);
    if (![GiveawayStatus.DRAFT, GiveawayStatus.COMPLETED, GiveawayStatus.CANCELLED].includes(g.status as never))
      throw new ConflictException('Seul un brouillon, un concours terminé ou annulé peut être archivé.');
    await this.prisma.giveaway.update({ where: { id }, data: { archivedAt: now, updatedById: actorId } });
    await this.audit.record({ giveawayId: id, actorId, action: 'giveaway.archived' });
    return this.get(id);
  }

  async cancel(id: string, reason: string, actorId: string, now = new Date()) {
    const g = await this.get(id);
    if (g.status === GiveawayStatus.COMPLETED || g.status === GiveawayStatus.CANCELLED) throw new ConflictException('Concours déjà terminé ou annulé.');
    if (await this.prisma.giveawayAward.count({ where: { giveawayId: id, status: GiveawayAwardStatus.ACTIVATED } }))
      throw new ConflictException('Des lots sont déjà activés : annulez-les d’abord.');
    await this.prisma.$transaction([
      this.prisma.giveaway.update({ where: { id }, data: { status: GiveawayStatus.CANCELLED, cancelledAt: now, updatedById: actorId } }),
      this.prisma.giveawayAward.updateMany({
        where: { giveawayId: id, status: { notIn: FINAL_AWARD } },
        data: { status: GiveawayAwardStatus.CANCELLED, cancelledAt: now, cancelReason: 'GIVEAWAY_CANCELLED' },
      }),
    ]);
    await this.audit.record({ giveawayId: id, actorId, action: 'giveaway.cancelled', data: { reason } });
    return this.get(id);
  }

  async duplicate(id: string, dto: DuplicateGiveawayDto, actorId: string) {
    const g = await this.get(id);
    return this.create(
      {
        slug: dto.slug,
        title: dto.title ?? `${g.title} (copie)`,
        description: g.description ?? undefined,
        opensAt: g.opensAt.toISOString(),
        closesAt: g.closesAt.toISOString(),
        drawAt: g.drawAt.toISOString(),
        timezone: g.timezone,
        rulesUrl: g.rulesUrl ?? undefined,
        rulesContent: g.rulesContent ?? undefined,
        config: readConfig(g.config),
        categories: g.categories.map((c) => ({
          key: c.key,
          label: c.label,
          description: c.description ?? undefined,
          criteria: c.criteria,
          winnersCount: c.winnersCount,
          alternatesCount: c.alternatesCount,
          sortOrder: c.sortOrder,
          prizes: c.prizes.map((p) => ({
            type: p.type,
            label: p.label,
            plan: p.plan ?? undefined,
            durationMonths: p.durationMonths ?? undefined,
            quantity: p.quantity,
            commercialValueCents: p.commercialValueCents ?? undefined,
            currency: p.currency,
          })),
        })),
      } as CreateGiveawayDto,
      actorId,
    );
  }

  /**
   * Avenant après ouverture. Autorisé : prolonger la clôture / décaler le
   * tirage, augmenter un lot, corriger le règlement (nouvelle version validée).
   * Interdit : réduire un lot, avancer la clôture, changer les critères.
   */
  async amend(id: string, dto: AmendGiveawayDto, actorId: string, now = new Date()) {
    const g = await this.get(id);
    if (!g.publishedAt || g.frozenAt || [GiveawayStatus.CANCELLED, GiveawayStatus.COMPLETED].includes(g.status as never))
      throw new ConflictException('Un avenant n’est possible que sur un concours publié, avant la clôture définitive.');
    const closesAt = dto.closesAt ? new Date(dto.closesAt) : g.closesAt;
    const drawAt = dto.drawAt ? new Date(dto.drawAt) : g.drawAt;
    if (closesAt < g.closesAt) throw new BadRequestException('La clôture ne peut être que prolongée.');
    if (dto.closesAt && closesAt <= now) throw new BadRequestException('La nouvelle clôture doit être dans le futur.');
    if (drawAt < closesAt) throw new BadRequestException('Le tirage ne peut pas précéder la clôture.');
    const prizeChanges = dto.prizes ?? [];
    for (const change of prizeChanges) {
      const prize = g.categories.flatMap((c) => c.prizes).find((p) => p.id === change.prizeId);
      if (!prize) throw new BadRequestException(`Lot inconnu : ${change.prizeId}.`);
      if (change.quantity !== undefined && change.quantity < prize.quantity) throw new BadRequestException('Un lot ne peut pas être réduit.');
    }
    const nextContent = dto.rulesContent ?? g.rulesContent;
    const nextUrl = dto.rulesUrl ?? g.rulesUrl;
    const before = { closesAt: g.closesAt, drawAt: g.drawAt, rulesVersion: g.rulesVersion, rulesHash: g.rulesHash, prizes: g.categories.flatMap((c) => c.prizes.map((p) => ({ id: p.id, quantity: p.quantity, commercialValueCents: p.commercialValueCents }))) };
    await this.prisma.$transaction(async (tx) => {
      for (const change of prizeChanges) {
        const prize = g.categories.flatMap((c) => c.prizes).find((p) => p.id === change.prizeId)!;
        const delta = (change.quantity ?? prize.quantity) - prize.quantity;
        await tx.giveawayPrize.update({
          where: { id: prize.id },
          data: { ...(change.quantity !== undefined ? { quantity: change.quantity } : {}), ...(change.commercialValueCents !== undefined ? { commercialValueCents: change.commercialValueCents } : {}) },
        });
        if (delta) await tx.giveawayCategory.update({ where: { id: prize.categoryId }, data: { winnersCount: { increment: delta } } });
      }
      await tx.giveaway.update({
        where: { id },
        data: {
          closesAt,
          drawAt,
          rulesContent: nextContent,
          rulesUrl: nextUrl,
          rulesHash: rulesHash(nextContent, nextUrl),
          rulesVersion: g.rulesVersion + 1,
          rulesApprovedAt: now,
          rulesApprovedById: actorId,
          updatedById: actorId,
        },
      });
    });
    const after = await this.get(id);
    await this.audit.record({
      giveawayId: id,
      actorId,
      action: 'giveaway.amended',
      data: JSON.parse(JSON.stringify({ reason: dto.reason, before, after: { closesAt: after.closesAt, drawAt: after.drawAt, rulesVersion: after.rulesVersion, rulesHash: after.rulesHash, prizes: prizeChanges } })) as Prisma.InputJsonValue,
    });
    await this.notifyAdmin(`giveaway:${id}:amendment:${after.rulesVersion}`, g.title, `Avenant n°${after.rulesVersion}`, [dto.reason]);
    return after;
  }

  // ───────────────────────────── Participations ─────────────────────────────

  async entries(id: string, q: EntriesQueryDto) {
    await this.get(id);
    const page = q.page ?? 1;
    const limit = q.limit ?? 25;
    const where: Prisma.GiveawayEntryWhereInput = {
      giveawayId: id,
      ...(q.status ? { status: q.status } : {}),
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.search
        ? { user: { OR: [{ salonName: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search, mode: 'insensitive' } }, { city: { contains: q.search, mode: 'insensitive' } }] } }
        : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.giveawayEntry.count({ where }),
      this.prisma.giveawayEntry.findMany({
        where,
        include: { user: { select: nameSelect }, category: { select: { key: true, label: true } } },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return {
      total,
      page,
      limit,
      items: items.map((e) => {
        const { identitySignals, ...rest } = e;
        void identitySignals; // empreintes anti-doublons : jamais renvoyées
        return rest;
      }),
    };
  }

  async stats(id: string) {
    const g = await this.get(id);
    const [byStatus, awards] = await Promise.all([
      this.prisma.giveawayEntry.groupBy({ by: ['categoryId', 'status'], where: { giveawayId: id }, _count: { _all: true } }),
      this.prisma.giveawayAward.groupBy({ by: ['categoryId', 'status'], where: { giveawayId: id }, _count: { _all: true } }),
    ]);
    return {
      categories: g.categories.map((c) => ({
        id: c.id,
        key: c.key,
        label: c.label,
        entries: Object.fromEntries(byStatus.filter((r) => r.categoryId === c.id).map((r) => [r.status, r._count._all])),
        awards: Object.fromEntries(awards.filter((r) => r.categoryId === c.id).map((r) => [r.status, r._count._all])),
      })),
    };
  }

  /** Export réservé aux admins, journalisé (sans les données exportées). */
  async exportCsv(id: string, actorId: string) {
    const g = await this.get(id);
    const items = await this.prisma.giveawayEntry.findMany({
      where: { giveawayId: id },
      include: { user: { select: nameSelect }, category: { select: { key: true } } },
      orderBy: { createdAt: 'asc' },
      take: 20000,
    });
    const header = ['entryId', 'category', 'status', 'invalidReason', 'createdAt', 'acceptedRulesAt', 'rulesVersion', 'userId', 'displayName', 'email', 'city', 'role', 'anonymized'];
    const rows = items.map((e) =>
      [e.id, e.category.key, e.status, e.invalidReason, e.createdAt, e.acceptedRulesAt, e.rulesVersion, e.userId, e.user ? publicDisplayName(e.user) : '', e.user?.email, e.user?.city, e.user?.role, e.anonymizedAt ? 'yes' : 'no']
        .map(csvCell)
        .join(';'),
    );
    await this.audit.record({ giveawayId: id, actorId, action: 'entries.exported', data: { rows: items.length } });
    return { filename: `${g.slug}-participations.csv`, content: `${String.fromCharCode(0xfeff)}${[header.join(';'), ...rows].join('\r\n')}` };
  }

  /** Contrôle à blanc de l'éligibilité de toutes les participations actives (aucune écriture). */
  async eligibilityReport(id: string) {
    const g = await this.get(id);
    const entries = await this.prisma.giveawayEntry.findMany({
      where: { giveawayId: id, status: { in: [GiveawayEntryStatus.VALID, GiveawayEntryStatus.PENDING_REVIEW] } },
      select: { id: true, userId: true, status: true },
      orderBy: { createdAt: 'asc' },
    });
    const report: { entryId: string; status: GiveawayEntryStatus; eligible: boolean; missingFields: string[] }[] = [];
    for (const e of entries) {
      if (!e.userId) {
        report.push({ entryId: e.id, status: e.status, eligible: false, missingFields: ['ACCOUNT_DELETED'] });
        continue;
      }
      const { result } = await this.eligibility.check(e.userId, g.categories);
      report.push({ entryId: e.id, status: e.status, eligible: result.eligible, missingFields: result.missingFields });
    }
    return { checked: report.length, ineligible: report.filter((r) => !r.eligible).length, items: report };
  }

  async reviewEntry(id: string, entryId: string, decision: 'VALID' | 'INVALID', note: string, actorId: string, now = new Date()) {
    const g = await this.get(id);
    if (g.frozenAt) throw new ConflictException('Liste figée : utilisez la procédure d’annulation de tirage si une correction est indispensable.');
    const entry = await this.prisma.giveawayEntry.findFirst({ where: { id: entryId, giveawayId: id } });
    if (!entry) throw new NotFoundException('Participation introuvable.');
    if (entry.status === GiveawayEntryStatus.WITHDRAWN) throw new ConflictException('Participation retirée par son auteur.');
    const updated = await this.prisma.giveawayEntry.update({
      where: { id: entryId },
      data: {
        status: decision,
        invalidReason: decision === 'INVALID' ? (entry.duplicateOfEntryIds.length ? 'DUPLICATE_ACCOUNT' : 'RULES_VIOLATION') : null,
        reviewedById: actorId,
        reviewedAt: now,
        reviewNote: note,
      },
    });
    await this.audit.record({ giveawayId: id, actorId, action: 'entry.reviewed', targetType: 'entry', targetId: entryId, data: { from: entry.status, to: decision } });
    return updated;
  }

  // ───────────────────────────── Clôture et tirage ─────────────────────────────

  /**
   * Fige la liste à la clôture : revérifie l'éligibilité de chaque
   * participation, refuse s'il reste des doublons à examiner, puis verrouille.
   */
  async freeze(id: string, confirmation: string, actorId: string, now = new Date()) {
    const g = await this.get(id);
    this.assertConfirmation(confirmation, g.slug);
    if (g.frozenAt) throw new ConflictException('Liste déjà figée.');
    if (g.status !== GiveawayStatus.SCHEDULED && g.status !== GiveawayStatus.ACTIVE) throw new ConflictException('Ce concours ne peut pas être clôturé.');
    if (now <= g.closesAt) throw new ConflictException('La période de participation n’est pas terminée.');
    const pending = await this.prisma.giveawayEntry.count({ where: { giveawayId: id, status: GiveawayEntryStatus.PENDING_REVIEW } });
    if (pending) throw new ConflictException({ code: 'PENDING_REVIEWS', message: `${pending} participation(s) à examiner avant la clôture.`, pending });

    const entries = await this.prisma.giveawayEntry.findMany({
      where: { giveawayId: id, status: GiveawayEntryStatus.VALID },
      select: { id: true, userId: true, reviewedAt: true },
    });
    const checks: { id: string; userId: string | null; reviewed: boolean; eligible: boolean; result: unknown; signals: string[] }[] = [];
    for (const e of entries) {
      if (!e.userId) {
        checks.push({ id: e.id, userId: null, reviewed: !!e.reviewedAt, eligible: false, result: { reason: 'ACCOUNT_DELETED' }, signals: [] });
        continue;
      }
      const loaded = await this.eligibility.loadUser(e.userId);
      const result = this.eligibility.evaluate(g.categories, loaded);
      checks.push({ id: e.id, userId: e.userId, reviewed: !!e.reviewedAt, eligible: result.eligible, result, signals: loaded ? identitySignals(loaded.user) : [] });
    }
    // Doublons apparus après l'inscription (profil modifié) : revue manuelle, jamais de rejet automatique.
    const bySignal = new Map<string, string[]>();
    for (const c of checks.filter((x) => x.eligible)) for (const s of c.signals) bySignal.set(s, [...(bySignal.get(s) ?? []), c.id]);
    const suspicious = new Set<string>();
    for (const ids of bySignal.values()) if (ids.length > 1) for (const entryId of ids) if (!checks.find((c) => c.id === entryId)!.reviewed) suspicious.add(entryId);
    if (suspicious.size) {
      await this.prisma.giveawayEntry.updateMany({ where: { id: { in: [...suspicious] } }, data: { status: GiveawayEntryStatus.PENDING_REVIEW } });
      await this.audit.record({ giveawayId: id, actorId, action: 'freeze.blocked-duplicates', data: { count: suspicious.size } });
      throw new ConflictException({ code: 'PENDING_REVIEWS', message: `${suspicious.size} participation(s) partagent des coordonnées : examinez-les avant la clôture.`, pending: suspicious.size });
    }

    await this.prisma.$transaction(
      async (tx) => {
        const locked = await tx.giveaway.updateMany({
          where: { id, frozenAt: null },
          data: { status: GiveawayStatus.CLOSED, frozenAt: now, frozenById: actorId },
        });
        if (!locked.count) throw new ConflictException('Liste déjà figée.');
        for (const c of checks) {
          await tx.giveawayEntry.update({
            where: { id: c.id },
            data: c.eligible
              ? { eligibilityAtClose: c.result as Prisma.InputJsonValue, closeCheckedAt: now }
              : { eligibilityAtClose: c.result as Prisma.InputJsonValue, closeCheckedAt: now, status: GiveawayEntryStatus.INVALID, invalidReason: c.userId ? 'INELIGIBLE_AT_CLOSE' : 'ACCOUNT_DELETED' },
          });
        }
      },
      { timeout: 120_000 },
    );
    const valid = await this.prisma.giveawayEntry.groupBy({ by: ['categoryId'], where: { giveawayId: id, status: GiveawayEntryStatus.VALID }, _count: { _all: true } });
    const summary = g.categories.map((c) => ({ key: c.key, eligible: valid.find((v) => v.categoryId === c.id)?._count._all ?? 0 }));
    await this.audit.record({ giveawayId: id, actorId, action: 'giveaway.frozen', data: { checked: checks.length, invalidated: checks.filter((c) => !c.eligible).length, categories: summary } });
    await this.notifyAdmin(`giveaway:${id}:frozen`, g.title, 'Liste des participants figée', summary.map((s) => `${s.key} : ${s.eligible} éligible(s)`));
    return { frozenAt: now, categories: summary };
  }

  /** Tirage officiel d'une catégorie : un seul par catégorie (contrainte unique + verrou). Jamais automatique. */
  async draw(id: string, categoryId: string, confirmation: string, actorId: string, now = new Date()) {
    const g = await this.get(id);
    this.assertConfirmation(confirmation, g.slug);
    if (!g.frozenAt || (g.status !== GiveawayStatus.CLOSED && g.status !== GiveawayStatus.DRAWN))
      throw new ConflictException('Figez la liste des participants avant le tirage.');
    if (now < g.drawAt) throw new ForbiddenException(`Le tirage officiel est prévu le ${g.drawAt.toISOString()}.`);
    const category = g.categories.find((c) => c.id === categoryId);
    if (!category) throw new NotFoundException('Catégorie introuvable.');

    const result = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`giveaway-draw:${categoryId}`}))`;
        const official = await tx.giveawayDraw.findUnique({ where: { officialKey: categoryId } });
        if (official) throw new ConflictException({ code: 'ALREADY_DRAWN', message: 'Un tirage officiel existe déjà pour cette catégorie.', drawId: official.id });
        const previous = await tx.giveawayDraw.findFirst({ where: { categoryId, status: GiveawayDrawStatus.VOIDED }, orderBy: { executedAt: 'desc' } });
        const entries = await tx.giveawayEntry.findMany({
          where: { giveawayId: id, categoryId, status: GiveawayEntryStatus.VALID, userId: { not: null } },
          select: { id: true, participantHash: true, userId: true },
          orderBy: { id: 'asc' },
        });
        const snapshot: DrawSnapshot = { giveawayId: id, categoryId, entries: entries.map((e) => ({ entryId: e.id, participantHash: e.participantHash })) };
        const seedHex = newDrawSeed();
        const drawn = runDraw(snapshot, category.winnersCount, category.alternatesCount, seedHex);
        const draw = await tx.giveawayDraw.create({
          data: {
            giveawayId: id,
            categoryId,
            officialKey: categoryId,
            algorithm: DRAW_ALGORITHM,
            seedHex,
            snapshot: snapshot as unknown as Prisma.InputJsonValue,
            snapshotHash: snapshotHash(snapshot),
            eligibleCount: entries.length,
            winnersCount: drawn.winners.length,
            alternatesCount: drawn.alternates.length,
            executedById: actorId,
            executedAt: now,
            supersedesId: previous?.id ?? null,
          },
        });
        const ordered = [
          ...drawn.winners.map((e) => ({ ...e, role: GiveawayDrawRole.WINNER })),
          ...drawn.alternates.map((e) => ({ ...e, role: GiveawayDrawRole.ALTERNATE })),
        ];
        const slots = category.prizes.flatMap((p) => Array.from({ length: p.quantity }, () => p.id));
        for (const [index, item] of ordered.entries()) {
          const res = await tx.giveawayDrawResult.create({ data: { drawId: draw.id, entryId: item.entryId, rank: index + 1, role: item.role } });
          if (item.role === GiveawayDrawRole.WINNER) {
            await tx.giveawayAward.create({
              data: {
                giveawayId: id,
                categoryId,
                prizeId: slots[index],
                entryId: item.entryId,
                drawResultId: res.id,
                userId: entries.find((e) => e.id === item.entryId)!.userId,
              },
            });
          }
        }
        const drawnCategories = await tx.giveawayDraw.count({ where: { giveawayId: id, status: GiveawayDrawStatus.OFFICIAL } });
        if (drawnCategories === g.categories.length) await tx.giveaway.update({ where: { id }, data: { status: GiveawayStatus.DRAWN } });
        return { draw, shortfall: drawn.shortfall };
      },
      { timeout: 60_000 },
    );
    await this.audit.record({
      giveawayId: id,
      actorId,
      action: 'draw.executed',
      targetType: 'draw',
      targetId: result.draw.id,
      data: { categoryKey: category.key, eligible: result.draw.eligibleCount, winners: result.draw.winnersCount, alternates: result.draw.alternatesCount, shortfall: result.shortfall, snapshotHash: result.draw.snapshotHash, algorithm: DRAW_ALGORITHM },
    });
    await this.notifyAdmin(`draw:${result.draw.id}:executed`, g.title, `Tirage ${category.label}`, [
      `${result.draw.eligibleCount} éligible(s), ${result.draw.winnersCount} gagnant(s), ${result.draw.alternatesCount} suppléant(s)`,
      ...(result.shortfall ? [`Attention : ${result.shortfall} lot(s) sans gagnant faute de participants.`] : []),
      'Les gagnants ne sont pas prévenus : confirmez chaque gain dans l’administration.',
    ]);
    return this.drawView(result.draw.id);
  }

  async drawView(drawId: string) {
    const draw = await this.prisma.giveawayDraw.findUnique({
      where: { id: drawId },
      include: {
        category: { select: { key: true, label: true } },
        results: { orderBy: { rank: 'asc' }, include: { entry: { include: { user: { select: nameSelect } } }, award: true } },
      },
    });
    if (!draw) throw new NotFoundException('Tirage introuvable.');
    const { snapshot, ...rest } = draw;
    void snapshot; // la liste figée reste en base pour l'audit, elle n'est pas renvoyée
    return rest;
  }

  async adminResults(id: string) {
    await this.get(id);
    const draws = await this.prisma.giveawayDraw.findMany({ where: { giveawayId: id }, select: { id: true }, orderBy: { executedAt: 'asc' } });
    return Promise.all(draws.map((d) => this.drawView(d.id)));
  }

  /**
   * Procédure exceptionnelle (erreur avérée) : annule un tirage officiel, ses
   * lots non activés et la publication des résultats. Un nouveau tirage pourra
   * être lancé ; il référence celui-ci. Tout est audité.
   */
  async voidDraw(id: string, drawId: string, reason: string, confirmation: string, actorId: string, now = new Date()) {
    const g = await this.get(id);
    this.assertConfirmation(confirmation, `ANNULER ${g.slug}`);
    const draw = await this.prisma.giveawayDraw.findFirst({ where: { id: drawId, giveawayId: id } });
    if (!draw || draw.status !== GiveawayDrawStatus.OFFICIAL) throw new NotFoundException('Tirage officiel introuvable.');
    const activated = await this.prisma.giveawayAward.count({ where: { drawResult: { drawId }, status: GiveawayAwardStatus.ACTIVATED } });
    if (activated) throw new ConflictException('Des lots de ce tirage sont activés : annulez-les d’abord (procédure lot par lot).');
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.giveawayDraw.updateMany({
        where: { id: drawId, status: GiveawayDrawStatus.OFFICIAL },
        data: { status: GiveawayDrawStatus.VOIDED, officialKey: null, voidedAt: now, voidedById: actorId, voidReason: reason },
      });
      if (!res.count) throw new ConflictException('Tirage déjà annulé.');
      await tx.giveawayAward.updateMany({
        where: { drawResult: { drawId }, status: { notIn: FINAL_AWARD } },
        data: { status: GiveawayAwardStatus.CANCELLED, cancelledAt: now, cancelReason: 'DRAW_VOIDED' },
      });
      await tx.giveaway.update({ where: { id }, data: { status: GiveawayStatus.CLOSED, resultsPublishedAt: null } });
    });
    await this.audit.record({ giveawayId: id, actorId, action: 'draw.voided', targetType: 'draw', targetId: drawId, data: { reason } });
    await this.notifyAdmin(`draw:${drawId}:voided`, g.title, 'Tirage annulé (procédure exceptionnelle)', [reason]);
    return { success: true };
  }

  // ───────────────────────────── Lots ─────────────────────────────

  private async getAward(awardId: string) {
    const award = await this.prisma.giveawayAward.findUnique({
      where: { id: awardId },
      include: { prize: true, giveaway: true, category: true, drawResult: true, grant: true, user: { select: nameSelect } },
    });
    if (!award) throw new NotFoundException('Lot introuvable.');
    return award;
  }

  /** Validation humaine du gagnant (identité, conformité) avant de le prévenir. */
  async confirmAward(awardId: string, actorId: string, now = new Date()) {
    const award = await this.getAward(awardId);
    if (award.status !== GiveawayAwardStatus.PENDING_CONFIRMATION) throw new ConflictException('Ce lot n’est pas en attente de confirmation.');
    if (!award.userId || !award.user) throw new ConflictException('Le compte gagnant n’existe plus : déclarez le lot perdu et désignez un suppléant.');
    const g = await this.get(award.giveawayId);
    const { result } = await this.eligibility.check(award.userId, g.categories);
    const deadline = new Date(now.getTime() + readConfig(g.config).acceptanceDays * 86_400_000);
    await this.prisma.giveawayAward.update({
      where: { id: awardId },
      data: { status: GiveawayAwardStatus.CONFIRMED, confirmedAt: now, confirmedById: actorId, acceptDeadline: deadline },
    });
    await this.audit.record({ giveawayId: g.id, actorId, action: 'award.confirmed', targetType: 'award', targetId: awardId, data: { eligibleNow: result.eligible } });
    await this.mailer.sendOnce(
      `award:${awardId}:winner`,
      'winner',
      award.user.email,
      winnerEmail({ name: publicDisplayName(award.user), title: g.title, prize: award.prize.label, url: studioGiveawayUrl(g.slug), deadline }),
      award.userId,
    );
    return { award: await this.getAward(awardId), eligibilityNow: result };
  }

  async forfeitAward(awardId: string, reason: string, actorId: string, now = new Date()) {
    const award = await this.getAward(awardId);
    if (FINAL_AWARD.includes(award.status)) throw new ConflictException('Ce lot est déjà clos.');
    await this.prisma.giveawayAward.update({ where: { id: awardId }, data: { status: GiveawayAwardStatus.FORFEITED, forfeitedAt: now, cancelReason: reason } });
    await this.audit.record({ giveawayId: award.giveawayId, actorId, action: 'award.forfeited', targetType: 'award', targetId: awardId, data: { reason } });
    return this.getAward(awardId);
  }

  /** Attribue un lot libéré (refus, perte, annulation) au suppléant suivant, dans l'ordre du tirage. */
  async promoteAlternate(drawId: string, actorId: string) {
    const draw = await this.prisma.giveawayDraw.findUnique({ where: { id: drawId }, include: { category: { include: { prizes: true } } } });
    if (!draw || draw.status !== GiveawayDrawStatus.OFFICIAL) throw new NotFoundException('Tirage officiel introuvable.');
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`giveaway-draw:${draw.categoryId}`}))`;
      const awards = await tx.giveawayAward.findMany({ where: { drawResult: { drawId } }, select: { prizeId: true, status: true, drawResultId: true } });
      const prize = draw.category.prizes.find((p) => awards.filter((a) => a.prizeId === p.id && !RELEASED_AWARD.includes(a.status)).length < p.quantity);
      if (!prize) throw new ConflictException('Aucun lot libéré à réattribuer.');
      const next = await tx.giveawayDrawResult.findFirst({
        where: { drawId, role: GiveawayDrawRole.ALTERNATE, award: { is: null }, entry: { status: GiveawayEntryStatus.VALID, userId: { not: null } } },
        include: { entry: true },
        orderBy: { rank: 'asc' },
      });
      if (!next) throw new ConflictException({ code: 'NO_ALTERNATE', message: 'Plus aucun suppléant disponible.' });
      return tx.giveawayAward.create({
        data: { giveawayId: draw.giveawayId, categoryId: draw.categoryId, prizeId: prize.id, entryId: next.entryId, drawResultId: next.id, userId: next.entry.userId },
      });
    });
    await this.audit.record({ giveawayId: draw.giveawayId, actorId, action: 'award.alternate-promoted', targetType: 'award', targetId: created.id, data: { drawId } });
    return this.getAward(created.id);
  }

  async notifyAlternates(drawId: string, actorId: string) {
    const draw = await this.prisma.giveawayDraw.findUnique({
      where: { id: drawId },
      include: { giveaway: true, results: { where: { role: GiveawayDrawRole.ALTERNATE, award: { is: null } }, include: { entry: { include: { user: { select: nameSelect } } } } } },
    });
    if (!draw || draw.status !== GiveawayDrawStatus.OFFICIAL) throw new NotFoundException('Tirage officiel introuvable.');
    let sent = 0;
    for (const r of draw.results) {
      if (!r.entry.user) continue;
      const status = await this.mailer.sendOnce(
        `draw:${drawId}:alternate:${r.entryId}`,
        'alternate',
        r.entry.user.email,
        alternateEmail({ name: publicDisplayName(r.entry.user), title: draw.giveaway.title, url: studioGiveawayUrl(draw.giveaway.slug) }),
        r.entry.userId,
      );
      if (status === 'SENT') sent++;
    }
    await this.audit.record({ giveawayId: draw.giveawayId, actorId, action: 'alternates.notified', targetType: 'draw', targetId: drawId, data: { sent } });
    return { sent };
  }

  async activationPreview(awardId: string) {
    const award = await this.getAward(awardId);
    if (award.status !== GiveawayAwardStatus.ACCEPTED) throw new ConflictException('Le gagnant doit d’abord accepter son lot.');
    if (award.prize.type !== GiveawayPrizeType.SUBSCRIPTION_GRANT || !award.prize.plan || !award.prize.durationMonths)
      throw new ConflictException('Ce lot ne s’active pas automatiquement.');
    if (!award.userId) throw new ConflictException('Compte gagnant supprimé.');
    return this.grants.preview(award.userId, award.prize.plan, award.prize.durationMonths);
  }

  async activate(awardId: string, dto: ActivateAwardDto, actorId: string, now = new Date()) {
    const award = await this.getAward(awardId);
    if (award.status === GiveawayAwardStatus.ACTIVATED && award.grant) return { award, grant: award.grant, created: false };
    if (award.status !== GiveawayAwardStatus.ACCEPTED) throw new ConflictException('Le gagnant doit d’abord accepter son lot.');
    if (award.prize.type !== GiveawayPrizeType.SUBSCRIPTION_GRANT || !award.prize.plan || !award.prize.durationMonths || !award.userId)
      throw new ConflictException('Ce lot ne s’active pas automatiquement.');
    const { grant, created } = await this.grants.apply({
      userId: award.userId,
      plan: award.prize.plan,
      durationMonths: award.prize.durationMonths,
      source: `giveaway:${award.giveaway.slug}`,
      actorId,
      idempotencyKey: `giveaway-award:${awardId}`,
      awardId,
      confirmation: dto.confirmation,
      requestId: dto.requestId,
    });
    await this.prisma.giveawayAward.updateMany({
      where: { id: awardId, status: GiveawayAwardStatus.ACCEPTED },
      data: { status: GiveawayAwardStatus.ACTIVATED, activatedAt: now, activatedById: actorId },
    });
    await this.audit.record({ giveawayId: award.giveawayId, actorId, action: 'award.activated', targetType: 'award', targetId: awardId, data: { grantId: grant.id, mode: grant.mode, startsAt: grant.startsAt.toISOString(), endsAt: grant.endsAt.toISOString() } });
    if (award.user)
      await this.mailer.sendOnce(
        `award:${awardId}:activated`,
        'award-activated',
        award.user.email,
        activationEmail({ name: publicDisplayName(award.user), title: award.giveaway.title, plan: grant.plan, startsAt: grant.startsAt, endsAt: grant.endsAt, stripeResumes: grant.mode === 'STRIPE_TRIAL_EXTENSION' }),
        award.userId,
      );
    return { award: await this.getAward(awardId), grant, created };
  }

  async cancelAward(awardId: string, reason: string, actorId: string, now = new Date()) {
    const award = await this.getAward(awardId);
    if (award.status === GiveawayAwardStatus.CANCELLED) return award;
    let entitlementReverted = false;
    if (award.grant) entitlementReverted = (await this.grants.cancel(award.grant.id, actorId, reason, now)).entitlementReverted;
    await this.prisma.giveawayAward.update({ where: { id: awardId }, data: { status: GiveawayAwardStatus.CANCELLED, cancelledAt: now, cancelReason: reason } });
    await this.audit.record({ giveawayId: award.giveawayId, actorId, action: 'award.cancelled', targetType: 'award', targetId: awardId, data: { reason, entitlementReverted } });
    return this.getAward(awardId);
  }

  // ───────────────────────────── Résultats, fin, données ─────────────────────────────

  async publishResults(id: string, actorId: string, now = new Date()) {
    const g = await this.get(id);
    if (g.status !== GiveawayStatus.DRAWN) throw new ConflictException('Toutes les catégories doivent avoir un tirage officiel.');
    await this.prisma.giveaway.update({ where: { id }, data: { resultsPublishedAt: now } });
    await this.audit.record({ giveawayId: id, actorId, action: 'results.published' });
    return this.get(id);
  }

  async complete(id: string, actorId: string, now = new Date()) {
    const g = await this.get(id);
    if (g.status !== GiveawayStatus.DRAWN) throw new ConflictException('Le concours doit être tiré.');
    const open = await this.prisma.giveawayAward.count({ where: { giveawayId: id, status: { notIn: FINAL_AWARD } } });
    if (open) throw new ConflictException(`${open} lot(s) restent à traiter.`);
    await this.prisma.giveaway.update({ where: { id }, data: { status: GiveawayStatus.COMPLETED, completedAt: now } });
    await this.audit.record({ giveawayId: id, actorId, action: 'giveaway.completed' });
    return this.get(id);
  }

  /**
   * Purge RGPD après la durée de conservation : les participations sans lot
   * perdent le lien avec le compte et les données de profil copiées ; restent
   * l'empreinte du participant, la date et la version du règlement acceptées
   * (preuve). Les gagnants sont conservés (preuve de remise des lots).
   */
  async purgePersonalData(id: string, actorId: string, now = new Date()) {
    const g = await this.get(id);
    const ref = g.completedAt ?? g.cancelledAt;
    if (!ref) throw new ConflictException('Le concours doit être terminé ou annulé.');
    const due = new Date(ref.getTime() + readConfig(g.config).retentionDays * 86_400_000);
    if (now < due) throw new ConflictException(`Durée de conservation en cours (jusqu’au ${due.toISOString()}).`);
    const targets = await this.prisma.giveawayEntry.findMany({ where: { giveawayId: id, anonymizedAt: null, awards: { none: {} } }, select: { id: true } });
    const ids = targets.map((t) => t.id);
    await this.prisma.$transaction([
      this.prisma.giveawayEntry.updateMany({
        where: { id: { in: ids } },
        data: { userId: null, eligibilityAtEntry: Prisma.DbNull, eligibilityAtClose: Prisma.DbNull, identitySignals: [], duplicateOfEntryIds: [], reviewNote: null, anonymizedAt: now },
      }),
      this.prisma.giveawayEmailDelivery.deleteMany({ where: { key: { in: ids.flatMap((e) => [`entry:${e}:confirmation`]) } } }),
      this.prisma.giveaway.update({ where: { id }, data: { personalDataPurgedAt: now } }),
    ]);
    await this.audit.record({ giveawayId: id, actorId, action: 'personal-data.purged', data: { anonymized: ids.length } });
    return { anonymized: ids.length };
  }

  async auditLog(id: string, page = 1) {
    await this.get(id);
    const take = 50;
    const [total, items] = await Promise.all([
      this.prisma.giveawayAuditLog.count({ where: { giveawayId: id } }),
      this.prisma.giveawayAuditLog.findMany({ where: { giveawayId: id }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * take, take }),
    ]);
    return { total, page, items };
  }
}
