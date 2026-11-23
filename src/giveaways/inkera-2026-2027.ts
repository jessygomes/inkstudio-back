import { GiveawayPrizeType, SaasPlan } from '@prisma/client';
import { businessPlan, proPlan } from '../../utils/data';
import type { CategoryInput } from './giveaway-definition';
import { parisInstant } from './giveaway-time';

/**
 * Concours Inkera 2026–2027 (créé en BROUILLON par
 * `npm run giveaway:seed-inkera-2026-2027`, jamais publié automatiquement).
 *
 * Valeurs commerciales : 12 × le tarif mensuel de `utils/data.ts` (prix
 * affiché par le site), à confirmer avant publication.
 */
export const INKERA_2026_SLUG = 'inkera-2026-2027';
const cents = (monthly: number, months: number) => Math.round(monthly * 100) * months;

export function inkera20262027Definition() {
  const categories: CategoryInput[] = [
    {
      key: 'independent',
      label: 'Tatoueur indépendant',
      description: 'Comptes tatoueur (créés avant ou pendant l’opération, gratuits ou abonnés).',
      winnersCount: 3,
      alternatesCount: 3,
      sortOrder: 0,
      criteria: [
        { type: 'ACCOUNT_TYPE', roles: ['user_tatoueur'] },
        { type: 'ACTIVE_ACCOUNT' },
        { type: 'PUBLIC_PROFILE' },
        { type: 'PROFILE_FIELD_REQUIRED', fields: ['NAME', 'PROFILE_PHOTO', 'CITY', 'DESCRIPTION', 'STYLE'] },
        { type: 'CONTACT_REQUIRED', min: 1 },
        { type: 'MIN_PUBLIC_PORTFOLIO_IMAGES', min: 5 },
      ],
      prizes: [
        {
          type: GiveawayPrizeType.SUBSCRIPTION_GRANT,
          label: 'Abonnement PRO offert 12 mois',
          plan: SaasPlan.PRO,
          durationMonths: 12,
          quantity: 3,
          commercialValueCents: cents(proPlan, 12),
          currency: 'EUR',
        },
      ],
    },
    {
      key: 'salon',
      label: 'Salon',
      description: 'Comptes salon (créés avant ou pendant l’opération, gratuits ou abonnés).',
      winnersCount: 1,
      alternatesCount: 3,
      sortOrder: 1,
      criteria: [
        // Le rôle legacy `user` n'est pas inclus : le plan Business est réservé à `user_salon` (SaasService.updateUserPlan).
        { type: 'ACCOUNT_TYPE', roles: ['user_salon'] },
        { type: 'ACTIVE_ACCOUNT' },
        { type: 'PUBLIC_PROFILE' },
        { type: 'PROFILE_FIELD_REQUIRED', fields: ['NAME', 'PROFILE_PHOTO', 'ADDRESS', 'POSTAL_CODE', 'CITY', 'DESCRIPTION', 'HOURS'] },
        { type: 'CONTACT_REQUIRED', min: 1 },
        // Photos de la galerie du salon (User.salonPhotos) et réalisations du portfolio, distinctes.
        { type: 'MIN_PUBLIC_STUDIO_IMAGES', min: 5, includePortfolio: true },
      ],
      prizes: [
        {
          type: GiveawayPrizeType.SUBSCRIPTION_GRANT,
          label: 'Abonnement BUSINESS offert 12 mois',
          plan: SaasPlan.BUSINESS,
          durationMonths: 12,
          quantity: 1,
          commercialValueCents: cents(businessPlan, 12),
          currency: 'EUR',
        },
      ],
    },
  ];
  return {
    slug: INKERA_2026_SLUG,
    title: 'Grand concours Inkera 2026–2027',
    description:
      'Complétez votre profil professionnel Inkera et tentez de gagner un abonnement offert pendant 12 mois : 3 abonnements PRO pour les tatoueurs indépendants, 1 abonnement BUSINESS pour un salon.',
    opensAt: parisInstant('2026-12-01', 0, 0),
    closesAt: parisInstant('2027-01-07', 23, 59, 59, 999),
    drawAt: parisInstant('2027-01-08', 10, 0),
    timezone: 'Europe/Paris',
    rulesContent:
      'PROJET DE RÈGLEMENT — À FAIRE VALIDER JURIDIQUEMENT AVANT PUBLICATION.\n\n' +
      'Organisateur, dates (du 1er décembre 2026 00:00 au 7 janvier 2027 23:59:59, heure de Paris), conditions de participation par catégorie, ' +
      'lots, modalités du tirage au sort (8 janvier 2027), acceptation et remise des lots, publication des résultats (avec consentement), ' +
      'données personnelles, et dépôt éventuel du règlement : à rédiger par le conseil juridique.',
    config: { acceptanceDays: 14, retentionDays: 365 },
    categories,
  };
}
