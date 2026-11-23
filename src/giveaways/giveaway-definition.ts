import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { GiveawayPrizeType, Prisma, SaasPlan } from '@prisma/client';
import { Criterion, parseCriteria } from './giveaway-criteria';

export type PrizeInput = {
  type: GiveawayPrizeType;
  label: string;
  plan?: SaasPlan | null;
  durationMonths?: number | null;
  quantity: number;
  commercialValueCents?: number | null;
  currency?: string;
};

export type CategoryInput = {
  key: string;
  label: string;
  description?: string | null;
  criteria: unknown;
  winnersCount: number;
  alternatesCount?: number;
  sortOrder?: number;
  prizes: PrizeInput[];
};

export type GiveawayConfig = {
  acceptanceDays: number;
  retentionDays: number;
  /** Visuel de la page publique (https uniquement). */
  coverImageUrl: string | null;
  /** Afficher la valeur commerciale des lots sur la page publique. */
  showPrizeValue: boolean;
};

export const DEFAULT_CONFIG: GiveawayConfig = { acceptanceDays: 14, retentionDays: 365, coverImageUrl: null, showPrizeValue: true };

function httpsUrl(x: unknown): string | null {
  if (typeof x !== 'string' || x.length > 2048) return null;
  try {
    return new URL(x).protocol === 'https:' ? x : null;
  } catch {
    return null;
  }
}

export function readConfig(value: Prisma.JsonValue | undefined | null): GiveawayConfig {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const int = (x: unknown, d: number, min: number, max: number) =>
    typeof x === 'number' && Number.isSafeInteger(x) && x >= min && x <= max ? x : d;
  return {
    acceptanceDays: int(v.acceptanceDays, DEFAULT_CONFIG.acceptanceDays, 1, 60),
    retentionDays: int(v.retentionDays, DEFAULT_CONFIG.retentionDays, 30, 1825),
    coverImageUrl: httpsUrl(v.coverImageUrl),
    showPrizeValue: typeof v.showPrizeValue === 'boolean' ? v.showPrizeValue : DEFAULT_CONFIG.showPrizeValue,
  };
}

export function rulesHash(content?: string | null, url?: string | null): string | null {
  if (!content && !url) return null;
  return createHash('sha256').update(JSON.stringify({ content: content ?? null, url: url ?? null })).digest('hex');
}

/** Règles métier d'un concours (en plus de la validation des DTO). */
export function validateDefinition(input: { opensAt: Date; closesAt: Date; drawAt: Date; categories: CategoryInput[] }) {
  if (![input.opensAt, input.closesAt, input.drawAt].every((d) => Number.isFinite(d.getTime())))
    throw new BadRequestException('Dates invalides.');
  if (!(input.opensAt < input.closesAt)) throw new BadRequestException('La clôture doit suivre l’ouverture.');
  if (input.drawAt < input.closesAt) throw new BadRequestException('Le tirage ne peut pas précéder la clôture.');
  const keys = new Set<string>();
  const parsed: { key: string; criteria: Criterion[] }[] = [];
  for (const category of input.categories) {
    if (keys.has(category.key)) throw new BadRequestException(`Catégorie en double : ${category.key}.`);
    keys.add(category.key);
    let criteria: Criterion[];
    try {
      criteria = parseCriteria(category.criteria, `categories.${category.key}.criteria`);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    const accountType = criteria.find((c): c is Extract<Criterion, { type: 'ACCOUNT_TYPE' }> => c.type === 'ACCOUNT_TYPE');
    if (!accountType)
      throw new BadRequestException(`La catégorie ${category.key} doit préciser le type de compte (ACCOUNT_TYPE).`);
    const total = category.prizes.reduce((sum, p) => sum + p.quantity, 0);
    if (total !== category.winnersCount)
      throw new BadRequestException(`Catégorie ${category.key} : la quantité de lots (${total}) doit égaler le nombre de gagnants (${category.winnersCount}).`);
    for (const prize of category.prizes) {
      if (prize.type === GiveawayPrizeType.SUBSCRIPTION_GRANT) {
        if (!prize.plan || prize.plan === SaasPlan.FREE || !prize.durationMonths)
          throw new BadRequestException(`Catégorie ${category.key} : un abonnement offert exige une formule (PRO / BUSINESS) et une durée.`);
        // Business n'existe que pour les comptes salon (SaasService.updateUserPlan).
        if (prize.plan === SaasPlan.BUSINESS && accountType.roles.some((r) => r !== 'user_salon'))
          throw new BadRequestException(`Catégorie ${category.key} : le plan Business est réservé aux comptes salon (ACCOUNT_TYPE = user_salon uniquement).`);
      }
    }
    parsed.push({ key: category.key, criteria });
  }
  // Un même rôle ne doit appartenir qu'à une catégorie : la catégorie est attribuée par le serveur, jamais choisie.
  const seen = new Map<string, string>();
  for (const p of parsed) {
    const roles = (p.criteria.find((c) => c.type === 'ACCOUNT_TYPE') as Extract<Criterion, { type: 'ACCOUNT_TYPE' }>).roles;
    for (const role of roles) {
      if (seen.has(role)) throw new BadRequestException(`Le type de compte ${role} figure dans deux catégories (${seen.get(role)}, ${p.key}).`);
      seen.set(role, p.key);
    }
  }
  return parsed;
}

export function categoryCreateData(categories: CategoryInput[], giveawayId?: string) {
  return categories.map((c, index) => ({
    key: c.key,
    label: c.label,
    description: c.description ?? null,
    criteria: parseCriteria(c.criteria) as unknown as Prisma.InputJsonValue,
    winnersCount: c.winnersCount,
    alternatesCount: c.alternatesCount ?? 0,
    sortOrder: c.sortOrder ?? index,
    prizes: c.prizes.map((p) => ({
      ...(giveawayId ? { giveawayId } : {}),
      type: p.type,
      label: p.label,
      plan: p.plan ?? null,
      durationMonths: p.durationMonths ?? null,
      quantity: p.quantity,
      commercialValueCents: p.commercialValueCents ?? null,
      currency: p.currency ?? 'EUR',
    })),
  }));
}
