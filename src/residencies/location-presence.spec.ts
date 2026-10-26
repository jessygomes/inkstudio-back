import {
  nextLocationChange,
  nextLocationPresence,
  parsePresence,
  samePriorityOverlap,
  venueOnDate,
} from './location-presence';

describe('Salon dates and recurring days', () => {
  const members = [
    {
      id: 'paris',
      salonId: 'paris',
      presence: { type: 'recurring', days: [4, 5] },
    },
    {
      id: 'toulouse',
      salonId: 'toulouse',
      presence: { type: 'recurring', days: [1, 2, 3] },
    },
  ];
  it('uses the right venue for each weekday without checking hours', () => {
    expect(venueOnDate(members, '2026-10-26')?.salonId).toBe('toulouse');
    expect(venueOnDate(members, '2026-10-29')?.salonId).toBe('paris');
    expect(venueOnDate(members, '2026-10-31')).toBeNull();
  });
  it('gives dated stays priority, includes the last day and resumes the usual venue', () => {
    const stay = {
      id: 'stay',
      salonId: 'lyon',
      presence: {
        type: 'period',
        startDate: '2026-10-26',
        endDate: '2026-11-02',
      },
    };
    expect(venueOnDate([...members, stay], '2026-10-29')?.salonId).toBe('lyon');
    expect(venueOnDate([...members, stay], '2026-11-02')?.salonId).toBe('lyon');
    expect(venueOnDate([...members, stay], '2026-11-03')?.salonId).toBe(
      'toulouse',
    );
  });
  it('supports a daily base with recurring visits elsewhere', () => {
    const base = { id: 'base', salonId: 'base', presence: { type: 'daily' } };
    expect(venueOnDate([...members, base], '2026-10-31')?.salonId).toBe('base');
    expect(venueOnDate([...members, base], '2026-10-29')?.salonId).toBe(
      'paris',
    );
  });
  it('validates dates and recurring day selection', () => {
    expect(() =>
      parsePresence({
        type: 'period',
        startDate: '2026-02-30',
        endDate: '2026-03-04',
      }),
    ).toThrow();
    expect(() => parsePresence({ type: 'recurring', days: [] })).toThrow();
    expect(() => parsePresence({ type: 'recurring', days: [8] })).toThrow();
    expect(parsePresence({ type: 'recurring', days: [5, 4, 4] })).toEqual({
      type: 'recurring',
      days: [4, 5],
    });
  });
  it('rejects conflicts of equal priority but allows a stay to replace recurrent days', () => {
    expect(
      samePriorityOverlap(
        { type: 'recurring', days: [1, 2] },
        { type: 'recurring', days: [2] },
      ),
    ).toBe(true);
    expect(
      samePriorityOverlap(
        { type: 'period', startDate: '2026-11-01', endDate: '2026-11-03' },
        { type: 'recurring', days: [2] },
      ),
    ).toBe(false);
  });
  it('expires a manual selection at the next location change, not every midnight', () => {
    expect(
      nextLocationChange(members, new Date('2026-10-26T12:00Z'))?.toISOString(),
    ).toBe('2026-10-28T23:00:00.000Z');
    expect(
      nextLocationPresence(
        members,
        'paris',
        new Date('2026-10-26T12:00Z'),
      )?.toISOString(),
    ).toBe('2026-10-28T23:00:00.000Z');
  });
  it('handles faraway stays and daylight savings boundaries', () => {
    const base = { id: 'base', salonId: 'base', presence: { type: 'daily' } };
    const stay = {
      id: 'stay',
      salonId: 'stay',
      presence: {
        type: 'period',
        startDate: '2027-04-01',
        endDate: '2027-04-15',
      },
    };
    expect(
      nextLocationChange(
        [base, stay],
        new Date('2026-10-26T12:00Z'),
      )?.toISOString(),
    ).toBe('2027-03-31T22:00:00.000Z');
    expect(
      nextLocationChange([base], new Date('2026-10-26T12:00Z')),
    ).toBeNull();
  });
});
