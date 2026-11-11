import { ForbiddenException } from '@nestjs/common';
import { parisTime } from '../residencies/presence';

export function isSameDayBookingBlocked(start: Date, allowSameDayBooking?: boolean | null, now = new Date()): boolean {
  return allowSameDayBooking === false && parisTime(start).date === parisTime(now).date;
}

export function assertSameDayBookingAllowed(start: Date, allowSameDayBooking?: boolean | null, now = new Date()) {
  if (isSameDayBookingBlocked(start, allowSameDayBooking, now))
    throw new ForbiddenException({ code: 'SAME_DAY_BOOKING_DISABLED', message: 'Ce professionnel n’autorise pas les réservations client le jour même.' });
}
