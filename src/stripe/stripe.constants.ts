import Stripe from 'stripe';

export const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2026-02-25.clover';

export const CHECKOUT_PLANS = ['PRO', 'BUSINESS'] as const;

export type CheckoutPlan = (typeof CHECKOUT_PLANS)[number];

export function isCheckoutPlan(value: unknown): value is CheckoutPlan {
  return CHECKOUT_PLANS.some((plan) => plan === value);
}

export function resolveStripeSecretKey(rawValue = process.env.STRIPE_SECRET_KEY): string {
  const value = (rawValue || '').trim().replace(/^['"]|['"]$/g, '');

  if (!value) {
    throw new Error('Configuration Stripe manquante: STRIPE_SECRET_KEY est vide ou absente.');
  }

  if (!/^sk_(test|live)_/.test(value)) {
    throw new Error('Configuration Stripe invalide: STRIPE_SECRET_KEY doit commencer par sk_test_ ou sk_live_.');
  }

  return value;
}
