import { minutes, parisDate, parisTime } from '../src/residencies/presence';

const days = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];
const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/** The public slot list and the write check use the same Paris calendar window. */
export function bookingHoursWindow(
  date: Date,
  json?: string | null,
): { start: Date; end: Date } | null {
  if (!Number.isFinite(date.getTime()) || !json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return null;
    const local = parisTime(date);
    const value = (parsed as Record<string, unknown>)[days[local.day - 1]];
    if (!value || typeof value !== 'object') return null;
    const { start, end } = value as { start?: unknown; end?: unknown };
    if (
      typeof start !== 'string' ||
      !clock.test(start) ||
      typeof end !== 'string' ||
      (!clock.test(end) && end !== '24:00')
    )
      return null;
    const window = {
      start: parisDate(local.date, minutes(start)),
      end: parisDate(local.date, end === '24:00' ? 1440 : minutes(end)),
    };
    return window.end > window.start ? window : null;
  } catch {
    return null;
  }
}
