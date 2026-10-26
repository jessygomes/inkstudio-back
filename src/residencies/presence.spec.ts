import {
  covers,
  currentPresence,
  nextPresence,
  overlap,
  parisDate,
  parseSchedule,
} from './presence';

describe('Recurring presence in Paris', () => {
  const monday = [{ day: 1, start: '09:00', end: '18:00' }];
  it('allows adjoining windows but rejects overlapping or malformed windows', () => {
    expect(overlap(monday[0], { day: 1, start: '18:00', end: '20:00' })).toBe(
      false,
    );
    expect(() =>
      parseSchedule([...monday, { day: 1, start: '17:00', end: '19:00' }]),
    ).toThrow();
    expect(() =>
      parseSchedule([{ day: 1, start: '18:00', end: '09:00' }]),
    ).toThrow();
    expect(() =>
      parseSchedule([{ day: 8, start: '09:00', end: '18:00' }]),
    ).toThrow();
  });
  it('converts local times across winter and summer without the server timezone', () => {
    expect(parisDate('2026-10-26', 540).toISOString()).toBe(
      '2026-10-26T08:00:00.000Z',
    );
    expect(parisDate('2026-07-06', 540).toISOString()).toBe(
      '2026-07-06T07:00:00.000Z',
    );
  });
  it('changes the current salon at the exact boundaries', () => {
    expect(currentPresence(monday, new Date('2026-10-26T08:00:00Z'))).toBe(
      true,
    );
    expect(currentPresence(monday, new Date('2026-10-26T17:00:00Z'))).toBe(
      false,
    );
    expect(
      nextPresence(monday, new Date('2026-10-26T18:00:00Z'))?.toISOString(),
    ).toBe('2026-11-02T08:00:00.000Z');
  });
  it('requires the entire appointment to fit one presence window', () => {
    expect(
      covers(
        monday,
        new Date('2026-10-26T08:00Z'),
        new Date('2026-10-26T17:00Z'),
      ),
    ).toBe(true);
    expect(
      covers(
        monday,
        new Date('2026-10-26T16:30Z'),
        new Date('2026-10-26T17:30Z'),
      ),
    ).toBe(false);
    expect(
      covers(
        monday,
        new Date('2026-10-26T09:00Z'),
        new Date('2026-10-26T08:00Z'),
      ),
    ).toBe(false);
  });
});
