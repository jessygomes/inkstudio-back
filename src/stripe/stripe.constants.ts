import Stripe from 'stripe';

export const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2026-02-25.clover';

export const CHECKOUT_PLANS = ['PRO', 'BUSINESS'] as const;

export type CheckoutPlan = (typeof CHECKOUT_PLANS)[number];

export function isCheckoutPlan(value: unknown): value is CheckoutPlan {
  return CHECKOUT_PLANS.some((plan) => plan === value);
}

function priceIds(...values: (string | undefined)[]): string[] {
  return values.flatMap((value) => (value ?? '').split(',')).map((id) => id.trim()).filter(Boolean);
}

/**
 * Formule correspondant à un prix Stripe.
 * STRIPE_PRICE_PRO / STRIPE_PRICE_BUSINESS : prix proposés aujourd'hui à l'inscription.
 * STRIPE_PRICE_PRO_LEGACY / STRIPE_PRICE_BUSINESS_LEGACY (identifiants séparés par des virgules) : anciens prix encore portés
 * par des abonnements existants. Sans eux, le webhook ignore ces abonnés après un changement de tarif.
 */
export function checkoutPlanFromPriceId(priceId: string): CheckoutPlan | null {
  if (priceIds(process.env.STRIPE_PRICE_BUSINESS, process.env.STRIPE_PRICE_BUSINESS_LEGACY).includes(priceId)) return 'BUSINESS';
  if (priceIds(process.env.STRIPE_PRICE_PRO, process.env.STRIPE_PRICE_PRO_LEGACY).includes(priceId)) return 'PRO';
  return null;
}

export function resolveStripeSecretKey(
  rawValue = process.env.STRIPE_SECRET_KEY,
): string {
  const value = (rawValue || '').trim().replace(/^['"]|['"]$/g, '');

  if (!value) {
    throw new Error(
      'Configuration Stripe manquante: STRIPE_SECRET_KEY est vide ou absente.',
    );
  }

  if (!/^sk_(test|live)_/.test(value)) {
    throw new Error(
      'Configuration Stripe invalide: STRIPE_SECRET_KEY doit commencer par sk_test_ ou sk_live_.',
    );
  }

  return value;
}
