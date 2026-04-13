import Stripe from 'stripe';

export const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2026-02-25.clover';

export const CHECKOUT_PLANS = ['PRO', 'BUSINESS'] as const;

export type CheckoutPlan = (typeof CHECKOUT_PLANS)[number];

export function isCheckoutPlan(value: unknown): value is CheckoutPlan {
  return CHECKOUT_PLANS.some((plan) => plan === value);
}
