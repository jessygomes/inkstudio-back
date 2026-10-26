import type Stripe from 'stripe';

export function readStripeAdminGift(subscription: Stripe.Subscription) {
  const start = Number(subscription.metadata?.inkera_gift_start);
  const end = Number(subscription.metadata?.inkera_gift_end);
  if (
    subscription.metadata?.inkera_admin_gift !== '1' ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start <= 0 ||
    end <= start ||
    end !== subscription.trial_end
  )
    return null;
  return { startDate: new Date(start * 1000), endDate: new Date(end * 1000) };
}

export type StripeGiftPreview = {
  currentPlan: 'PRO' | 'BUSINESS';
  startDate: string;
  endDate: string;
  amount: number;
  currency: string;
  interval: string;
  intervalCount: number;
  confirmation: string;
  requestId: string;
};
