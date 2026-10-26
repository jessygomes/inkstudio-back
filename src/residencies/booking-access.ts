import { SaasPlan, SaasPlanStatus } from '@prisma/client';

export const businessBillingFields = {
  role: true, saasPlan: true, saasPlanUntil: true,
  saasPlanDetails: { select: { currentPlan: true, planStatus: true, endDate: true, trialEndDate: true } },
} as const;

type BusinessAccount = {
  role?: string; saasPlan?: string; saasPlanUntil?: Date | string | null;
  saasPlanDetails?: { currentPlan?: string; planStatus?: string; endDate?: Date | string | null; trialEndDate?: Date | string | null } | null;
};
export function hasActiveBusiness(account?: BusinessAccount | null, now = new Date()): boolean {
  if (account?.role !== 'user_salon' || account.saasPlan !== SaasPlan.BUSINESS) return false;
  const details = account.saasPlanDetails;
  // Keep the existing paid-access window for cancellations and payment grace periods.
  if (details && (details.currentPlan !== SaasPlan.BUSINESS || details.planStatus === SaasPlanStatus.EXPIRED)) return false;
  const dates = [account.saasPlanUntil, details?.endDate, ...(details?.planStatus === SaasPlanStatus.TRIAL ? [details.trialEndDate] : [])];
  return dates.every(date => !date || new Date(date).getTime() > now.getTime());
}
export function canBookLinkedArtist(artist: { saasPlan?: string }, salon: BusinessAccount): boolean {
  return artist.saasPlan !== SaasPlan.FREE || hasActiveBusiness(salon);
}
