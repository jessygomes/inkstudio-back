import { GiveawayPrizeType, SaasPlan } from '@prisma/client';
import { businessPlan, proPlan } from '../../utils/data';
import { CONTACT_CHANNELS, CRITERION_TYPES, PARTICIPANT_ROLES, PROFILE_FIELDS } from './giveaway-criteria';
import { DEFAULT_CONFIG } from './giveaway-definition';
import { SUPPORTED_TIMEZONES } from './giveaway-time';

/**
 * Catalogue exposé au back-office : ce que l'API accepte réellement (critères en
 * liste blanche, champs, canaux, rôles, formules offrables). Le front construit
 * ses formulaires à partir de cette réponse, sans liste codée en dur.
 */
export function giveawayOptions() {
  return {
    criterionTypes: [...CRITERION_TYPES],
    profileFields: [...PROFILE_FIELDS],
    contactChannels: [...CONTACT_CHANNELS],
    participantRoles: [...PARTICIPANT_ROLES],
    timezones: [...SUPPORTED_TIMEZONES],
    prizeTypes: [GiveawayPrizeType.SUBSCRIPTION_GRANT],
    /** Formules offrables, avec le tarif mensuel public (utils/data.ts) et les comptes qui peuvent les recevoir. */
    plans: [
      { plan: SaasPlan.PRO, monthlyPrice: proPlan, currency: 'EUR', roles: ['user_tatoueur', 'user_salon', 'user'] },
      { plan: SaasPlan.BUSINESS, monthlyPrice: businessPlan, currency: 'EUR', roles: ['user_salon'] },
    ],
    limits: {
      maxCategories: 10,
      maxPrizesPerCategory: 10,
      maxWinnersPerCategory: 100,
      maxAlternatesPerCategory: 50,
      maxDurationMonths: 36,
      maxCriteriaDepth: 3,
      maxCriteriaNodes: 40,
      maxImages: 500,
      acceptanceDays: { min: 1, max: 60 },
      retentionDays: { min: 30, max: 1825 },
    },
    defaults: DEFAULT_CONFIG,
  };
}
