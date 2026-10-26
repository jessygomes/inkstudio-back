import { parisDate, parisTime } from './presence';

export type LocationPresence =
  | { type: 'daily' }
  | { type: 'recurring'; days: number[] }
  | { type: 'period'; startDate: string; endDate: string };
type Located = { id: string; salonId: string; presence: unknown };

export function validDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function parsePresence(value: unknown): LocationPresence | null {
  if (value === null || value === undefined) return null;
  const p = value as LocationPresence;
  if (p.type === 'daily') return { type: 'daily' };
  if (
    p.type === 'recurring' &&
    Array.isArray(p.days) &&
    p.days.length &&
    p.days.length <= 7 &&
    p.days.every((d) => Number.isInteger(d) && d >= 1 && d <= 7)
  )
    return { type: 'recurring', days: [...new Set(p.days)].sort() };
  if (
    p.type === 'period' &&
    validDate(p.startDate) &&
    validDate(p.endDate) &&
    p.startDate <= p.endDate
  )
    return { type: 'period', startDate: p.startDate, endDate: p.endDate };
  throw new Error(
    'Choisissez une présence quotidienne, des jours récurrents ou une période avec des dates valides.',
  );
}
export function matches(p: LocationPresence, date: string) {
  return (
    p.type === 'daily' ||
    (p.type === 'period'
      ? p.startDate <= date && date <= p.endDate
      : p.days.includes(parisTime(parisDate(date, 720)).day))
  );
}
export function samePriorityOverlap(
  a: LocationPresence | null,
  b: LocationPresence | null,
) {
  if (!a || !b || a.type !== b.type) return false;
  if (a.type === 'daily') return true;
  if (a.type === 'period' && b.type === 'period')
    return a.startDate <= b.endDate && b.startDate <= a.endDate;
  return (
    a.type === 'recurring' &&
    b.type === 'recurring' &&
    a.days.some((d) => b.days.includes(d))
  );
}
const priority = { daily: 1, recurring: 2, period: 3 };
export function venueOnDate<T extends Located>(
  members: T[],
  date: string,
): T | null {
  return (
    members
      .map((member) => ({ member, presence: parsePresence(member.presence) }))
      .filter((r) => r.presence && matches(r.presence, date))
      .sort(
        (a, b) =>
          priority[b.presence!.type] - priority[a.presence!.type] ||
          a.member.id.localeCompare(b.member.id),
      )[0]?.member ?? null
  );
}
export function nextDate(date: string, days = 1) {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}
function boundaries(members: Located[], at: Date) {
  const today = parisTime(at).date;
  const dates = new Set(
    Array.from({ length: 8 }, (_, i) => nextDate(today, i + 1)),
  );
  for (const member of members) {
    const p = parsePresence(member.presence);
    if (p?.type === 'period') {
      for (let i = 0; i < 8; i++) {
        dates.add(nextDate(p.startDate, i));
        dates.add(nextDate(p.endDate, i + 1));
      }
    }
  }
  return [...dates].filter((date) => date > today).sort();
}
export function nextLocationChange(
  members: Located[],
  at = new Date(),
): Date | null {
  const current = venueOnDate(members, parisTime(at).date)?.id;
  const date = boundaries(members, at).find(
    (date) => venueOnDate(members, date)?.id !== current,
  );
  return date ? parisDate(date, 0) : null;
}
export function nextLocationPresence(
  members: Located[],
  id: string,
  at = new Date(),
): Date | null {
  const date = boundaries(members, at).find(
    (date) => venueOnDate(members, date)?.id === id,
  );
  return date ? parisDate(date, 0) : null;
}
