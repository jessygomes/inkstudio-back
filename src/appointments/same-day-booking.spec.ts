import { assertSameDayBookingAllowed, isSameDayBookingBlocked } from './same-day-booking';
import { validateInternalBooking } from './internal-booking-policy';
import { ResidenciesService } from '../residencies/residencies.service';
import { TimeSlotService } from '../time-slot/time-slot.service';

describe('Same-day client booking policy', () => {
  afterEach(() => jest.useRealTimers());
  it.each([
    ['2027-01-01T23:15:00Z', '2027-01-02T09:00:00Z', true],
    ['2027-03-27T23:15:00Z', '2027-03-28T08:00:00Z', true],
    ['2027-10-30T22:15:00Z', '2027-10-31T09:00:00Z', true],
    ['2027-01-01T22:59:00Z', '2027-01-01T23:15:00Z', false],
  ])('uses Paris calendar dates across midnight and DST', (now, start, blocked) => {
    expect(isSameDayBookingBlocked(new Date(start), false, new Date(now))).toBe(blocked);
  });
  it('retains the old behavior when the setting is true or absent', () => {
    const now = new Date('2027-01-04T08:00:00Z');
    expect(isSameDayBookingBlocked(now, true, now)).toBe(false);
    expect(isSameDayBookingBlocked(now, undefined, now)).toBe(false);
    expect(() => assertSameDayBookingAllowed(now, false, now)).toThrow('le jour même');
  });
  it('rejects public internal bookings but leaves professional creation available', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2027-01-04T08:00:00Z'));
    const tx = {
      $queryRaw: jest.fn(),
      user: { findUnique: jest.fn().mockResolvedValue({ role: 'user_salon', allowSameDayBooking: false }) },
      tatoueur: { findFirst: jest.fn().mockResolvedValue({ id: 'artist' }) },
      appointment: { findFirst: jest.fn().mockResolvedValue(null) },
      blockedTimeSlot: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const slot = { userId: 'salon', tatoueurId: 'artist', start: new Date('2027-01-04T09:00:00Z'), end: new Date('2027-01-04T10:00:00Z') };
    await expect(validateInternalBooking(tx as any, slot, true)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'SAME_DAY_BOOKING_DISABLED' }) });
    await expect(validateInternalBooking(tx as any, slot, false)).resolves.toBeUndefined();
  });
  it.each(['artist', 'salon'])('honors the %s restriction for a linked artist', async restricted => {
    jest.useFakeTimers().setSystemTime(new Date('2027-01-04T08:00:00Z'));
    const db = { user: { findUnique: jest.fn(({ where }) => Promise.resolve({ allowSameDayBooking: where.id !== restricted })) } };
    const service = new ResidenciesService(db as any, {} as any);
    await expect(service.venueSnapshot('artist', 'artist', 'salon', null, true, new Date('2027-01-04T09:00:00Z'), new Date('2027-01-04T10:00:00Z'))).rejects.toMatchObject({ response: expect.objectContaining({ code: 'SAME_DAY_BOOKING_DISABLED' }) });
  });
  it('hides today even when includeUnavailable is requested on the public slot route', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2027-01-04T08:00:00Z'));
    const db = { user: { findUnique: jest.fn().mockResolvedValue({ allowSameDayBooking: false }) } };
    const slots = new TimeSlotService(db as any);
    await expect(slots.generateTimeSlotsForDate(new Date('2027-01-04T12:00:00Z'), JSON.stringify({ monday: { start: '09:00', end: '18:00' } }), 'salon', undefined, true)).resolves.toEqual([]);
  });
});
