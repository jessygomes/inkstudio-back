import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  Criterion,
  CriterionResult,
  categoryAppliesTo,
  evaluateCriteria,
  parseCriteria,
} from './giveaway-criteria';
import { EligibilityUser, eligibilityUserSelect, identitySignals, profileFacts } from './giveaway-profile';

export type CategoryLike = { id: string; key: string; label: string; sortOrder: number; criteria: Prisma.JsonValue };

export type EligibilityResult = {
  eligible: boolean;
  category: { id: string; key: string; label: string } | null;
  criteria: CriterionResult[];
  missingFields: string[];
  /** Raison globale quand aucune catégorie ne s'applique (compte client, admin…). */
  reason?: 'NO_MATCHING_CATEGORY' | 'ACCOUNT_NOT_FOUND';
};

type Db = Pick<PrismaService, 'user' | 'portfolio'> | Prisma.TransactionClient;

@Injectable()
export class GiveawayEligibilityService {
  constructor(private readonly prisma: PrismaService) {}

  async loadUser(userId: string, db: Db = this.prisma): Promise<{ user: EligibilityUser; portfolioUrls: string[] } | null> {
    const user = (await db.user.findUnique({ where: { id: userId }, select: eligibilityUserSelect })) as EligibilityUser | null;
    if (!user) return null;
    const portfolio = await db.portfolio.findMany({ where: { userId }, select: { imageUrl: true } });
    return { user, portfolioUrls: portfolio.map((p) => p.imageUrl) };
  }

  /** Catégorie d'un compte : la première (ordre d'affichage) dont les critères ACCOUNT_TYPE l'acceptent. */
  static categoryFor<T extends CategoryLike>(categories: T[], role: string): T | null {
    const sorted = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);
    return sorted.find((c) => categoryAppliesTo(parseCriteria(c.criteria), role)) ?? null;
  }

  evaluate(categories: CategoryLike[], loaded: { user: EligibilityUser; portfolioUrls: string[] } | null): EligibilityResult {
    if (!loaded)
      return { eligible: false, category: null, criteria: [], missingFields: [], reason: 'ACCOUNT_NOT_FOUND' };
    const category = GiveawayEligibilityService.categoryFor(categories, loaded.user.role);
    if (!category)
      return { eligible: false, category: null, criteria: [], missingFields: ['ACCOUNT_TYPE'], reason: 'NO_MATCHING_CATEGORY' };
    const criteria: Criterion[] = parseCriteria(category.criteria);
    const facts = profileFacts(loaded.user, loaded.portfolioUrls);
    const result = evaluateCriteria(criteria, facts);
    return { ...result, category: { id: category.id, key: category.key, label: category.label } };
  }

  async check(userId: string, categories: CategoryLike[], db: Db = this.prisma) {
    const loaded = await this.loadUser(userId, db);
    return { result: this.evaluate(categories, loaded), user: loaded?.user ?? null, signals: loaded ? identitySignals(loaded.user) : [] };
  }
}
