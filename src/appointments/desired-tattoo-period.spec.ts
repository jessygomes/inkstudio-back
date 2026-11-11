import { BadRequestException } from '@nestjs/common';
import { DesiredTattooPeriod } from '@prisma/client';
import { desiredPeriodData } from './desired-tattoo-period';

describe('Project desired tattoo period', () => {
  it.each(['ASAP', 'FLEXIBLE', 'UNDECIDED'] as const)(
    'persists %s without dates',
    (desiredTattooPeriod) => {
      expect(desiredPeriodData({ desiredTattooPeriod }, 'PROJET')).toEqual({
        desiredTattooPeriod,
        desiredTattooDate: null,
        desiredTattooStartDate: null,
        desiredTattooEndDate: null,
      });
    },
  );
  it('persists an exact civil date without scheduling an appointment', () => {
    expect(
      desiredPeriodData(
        { desiredTattooPeriod: 'EXACT_DATE', desiredTattooDate: '2027-03-28' },
        'PROJET',
      ),
    ).toMatchObject({ desiredTattooDate: new Date('2027-03-28T00:00:00Z') });
  });
  it('persists an inclusive range', () => {
    expect(
      desiredPeriodData(
        {
          desiredTattooPeriod: 'DATE_RANGE',
          desiredTattooStartDate: '2027-03-28',
          desiredTattooEndDate: '2027-04-02',
        },
        'PROJET',
      ),
    ).toMatchObject({
      desiredTattooStartDate: new Date('2027-03-28T00:00:00Z'),
      desiredTattooEndDate: new Date('2027-04-02T00:00:00Z'),
    });
  });
  it('preserves legacy omissions and explicitly clears a preference', () => {
    expect(desiredPeriodData({}, 'PROJET')).toEqual({});
    expect(
      desiredPeriodData({ desiredTattooPeriod: null }, 'PROJET'),
    ).toMatchObject({ desiredTattooPeriod: null, desiredTattooDate: null });
  });
  it.each([
    { desiredTattooPeriod: 'EXACT_DATE' },
    { desiredTattooPeriod: 'EXACT_DATE', desiredTattooDate: '2027-02-30' },
    {
      desiredTattooPeriod: 'DATE_RANGE',
      desiredTattooStartDate: '2027-04-02',
      desiredTattooEndDate: '2027-04-01',
    },
    { desiredTattooPeriod: 'DATE_RANGE', desiredTattooStartDate: '2027-04-02' },
    { desiredTattooPeriod: 'ASAP', desiredTattooDate: '2027-04-02' },
    {
      desiredTattooPeriod: 'EXACT_DATE',
      desiredTattooDate: '2027-04-02',
      desiredTattooEndDate: '2027-04-02',
    },
    { desiredTattooDate: '2027-04-02' },
    { desiredTattooPeriod: 'invented' },
  ])('rejects incoherent preferences: %j', (body) => {
    expect(() =>
      desiredPeriodData(
        body as { desiredTattooPeriod?: DesiredTattooPeriod },
        'PROJET',
      ),
    ).toThrow(BadRequestException);
  });
  it.each(['TATTOO', 'RETOUCHE', 'PIERCING'])(
    'rejects a preference on %s',
    (type) => {
      expect(() =>
        desiredPeriodData({ desiredTattooPeriod: 'ASAP' }, type),
      ).toThrow(BadRequestException);
    },
  );
});
