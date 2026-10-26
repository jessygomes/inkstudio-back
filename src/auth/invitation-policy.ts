import { createHash } from 'crypto';

export const invitationTokenHash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

// Calendar months, clamped to the last day (e.g. 29 February + one year).
export function invitationEndDate(start: Date, months: number): Date {
  const end = new Date(start);
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0),
  ).getUTCDate();
  end.setUTCDate(Math.min(day, lastDay));
  return end;
}
