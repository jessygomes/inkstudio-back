import { BookingLinkMode } from '@prisma/client';
import { bookingHoursWindow } from '../../utils/booking-hours';
import { minutes, parisDate, parisTime } from '../residencies/presence';

/** Same 30-minute starting grid as the existing calendar, with an exact elapsed duration. */
export function bookingLinkCandidates(
  date: string,
  hours: string | null,
  durationMinutes: number,
  mode: BookingLinkMode,
  fixedStartTime: string | null,
  now = new Date(),
) {
  const window = bookingHoursWindow(parisDate(date, 720), hours);
  if (!window) return [];
  const candidates: { start: Date; end: Date }[] = [];
  const first =
    mode === 'FIXED_START'
      ? parisDate(date, minutes(fixedStartTime!))
      : window.start;
  const last = mode === 'FIXED_START' ? first : window.end;
  for (
    let instant = first.getTime();
    instant <= last.getTime();
    instant += 30 * 60000
  ) {
    const start = new Date(instant);
    const end = new Date(instant + durationMinutes * 60000);
    const local = parisTime(start);
    // A non-existent Paris wall clock (spring change) must never move silently.
    if (
      local.date !== date ||
      (mode === 'FIXED_START' && local.minute !== minutes(fixedStartTime!))
    )
      continue;
    if (start > now && start >= window.start && end <= window.end)
      candidates.push({ start, end });
  }
  return candidates;
}
