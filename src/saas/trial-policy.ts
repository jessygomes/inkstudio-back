export const TRIAL_REMINDER_DAYS = [7, 3, 1] as const;
export const DAY_MS = 86_400_000;

export function nativeTrialEndDate(role: string, plan: string, from = new Date(), proMonths = 3): Date | null {
  if (role === 'user_salon' && plan === 'BUSINESS') return new Date(from.getTime() + 60 * DAY_MS);
  if (role !== 'user_tatoueur' || plan !== 'PRO') return null;
  const end = new Date(from);
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + proMonths);
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, lastDay));
  return end;
}

// Schedule the remaining milestones and, after an outage, only the latest due one.
export function reminderMilestones(end: Date, now = new Date()) {
  const remaining = end.getTime() - now.getTime();
  if (!Number.isFinite(remaining) || remaining <= 0) return [];
  const due = [...TRIAL_REMINDER_DAYS].reverse().find(days => remaining <= days * DAY_MS);
  return TRIAL_REMINDER_DAYS.filter(days => end.getTime() - days * DAY_MS >= now.getTime() || days === due)
    .map(daysBeforeEnd => ({ daysBeforeEnd, delay: Math.max(0, end.getTime() - daysBeforeEnd * DAY_MS - now.getTime()) }));
}
