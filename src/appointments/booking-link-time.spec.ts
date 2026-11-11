import { bookingLinkCandidates } from './booking-link-time';

const hours = JSON.stringify(
  Object.fromEntries(
    [
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ].map((day) => [day, { start: '09:00', end: '18:00' }]),
  ),
);
const now = new Date('2026-01-01T00:00:00Z');
describe('Exact-duration booking slots in Europe/Paris', () => {
  it('keeps the existing half-hour starting grid with custom elapsed durations', () => {
    const slots = bookingLinkCandidates(
      '2027-01-04',
      hours,
      175,
      'AUTOMATIC',
      null,
      now,
    );
    expect(slots[0]).toEqual({
      start: new Date('2027-01-04T08:00:00Z'),
      end: new Date('2027-01-04T10:55:00Z'),
    });
    expect(slots[1].start.getTime() - slots[0].start.getTime()).toBe(1800000);
    expect(slots.at(-1)!.end <= new Date('2027-01-04T17:00:00Z')).toBe(true);
  });
  it.each([
    ['2027-03-27', '09:00'],
    ['2027-03-28', '08:00'],
    ['2027-10-30', '08:00'],
    ['2027-10-31', '09:00'],
  ])('uses the Paris offset on %s', (day, utc) => {
    expect(
      bookingLinkCandidates(day, hours, 240, 'FIXED_START', '10:00', now),
    ).toEqual([
      {
        start: new Date(`${day}T${utc}:00Z`),
        end: new Date(new Date(`${day}T${utc}:00Z`).getTime() + 240 * 60000),
      },
    ]);
  });
  it('rejects a non-existent fixed wall-clock time at spring DST', () => {
    expect(
      bookingLinkCandidates(
        '2027-03-28',
        JSON.stringify({ sunday: { start: '00:00', end: '08:00' } }),
        60,
        'FIXED_START',
        '02:30',
        now,
      ),
    ).toEqual([]);
  });
  it('never duplicates UTC instants on the autumn repeated hour', () => {
    const slots = bookingLinkCandidates(
      '2027-10-31',
      JSON.stringify({ sunday: { start: '00:00', end: '05:00' } }),
      90,
      'AUTOMATIC',
      null,
      now,
    );
    expect(new Set(slots.map((s) => s.start.getTime())).size).toBe(
      slots.length,
    );
    expect(
      slots.every((s) => s.end.getTime() - s.start.getTime() === 90 * 60000),
    ).toBe(true);
    expect(
      slots.some((s) => s.start.toISOString() === '2027-10-31T00:30:00.000Z'),
    ).toBe(true);
    expect(
      slots.some((s) => s.start.toISOString() === '2027-10-31T01:30:00.000Z'),
    ).toBe(true);
  });
  it('does not round a predefined time to the automatic grid', () => {
    expect(
      bookingLinkCandidates(
        '2027-01-04',
        hours,
        35,
        'FIXED_START',
        '10:17',
        now,
      )[0],
    ).toEqual({
      start: new Date('2027-01-04T09:17:00Z'),
      end: new Date('2027-01-04T09:52:00Z'),
    });
  });
  it('rejects dates without hours, past starts, and insufficient full windows', () => {
    expect(
      bookingLinkCandidates('2027-01-04', null, 60, 'AUTOMATIC', null, now),
    ).toEqual([]);
    expect(
      bookingLinkCandidates(
        '2027-01-04',
        hours,
        240,
        'FIXED_START',
        '16:00',
        now,
      ),
    ).toEqual([]);
    expect(
      bookingLinkCandidates(
        '2027-01-04',
        hours,
        60,
        'AUTOMATIC',
        null,
        new Date('2028-01-01'),
      ),
    ).toEqual([]);
  });
});
