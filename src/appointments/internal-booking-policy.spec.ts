/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  validateInternalBooking,
  updateInternalBooking,
} from './internal-booking-policy';
import { bookingHoursWindow } from '../../utils/booking-hours';
import { ResidenciesService } from '../residencies/residencies.service';
import { BlockedTimeSlotsService } from '../blocked-time-slots/blocked-time-slots.service';
import { TimeSlotService } from '../time-slot/time-slot.service';

const hours = (start = '09:00', end = '18:00') =>
  JSON.stringify(
    Object.fromEntries(
      [
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
        'sunday',
      ].map((day) => [day, { start, end }]),
    ),
  );
const data = {
  userId: 'salon',
  tatoueurId: 'artist',
  start: new Date('2030-02-15T09:00:00Z'),
  end: new Date('2030-02-15T10:00:00Z'),
  prestation: 'TATTOO' as const,
};
function fixture() {
  const salon = {
    role: 'user_salon',
    publicVisibility: 'VISIBLE',
    saasPlan: 'PRO',
    salonHours: hours(),
    prestations: ['TATTOO'],
    saasPlanDetails: {
      currentPlan: 'PRO',
      agendaMode: 'PAR_TATOUEUR',
      planStatus: 'ACTIVE',
    },
  };
  const artist = { id: 'artist', hours: hours(), rdvBookingEnabled: true };
  const current = {
    ...data,
    id: 'appointment',
    status: 'PENDING',
    clientUserId: 'client',
    performerUserId: null,
  };
  const tx: any = {
    $queryRaw: jest.fn(),
    user: {
      findUnique: jest.fn().mockResolvedValue(salon),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ salonName: 'Salon' }),
    },
    tatoueur: { findFirst: jest.fn().mockResolvedValue(artist) },
    blockedTimeSlot: { findFirst: jest.fn().mockResolvedValue(null) },
    appointment: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUniqueOrThrow: jest.fn().mockResolvedValue(current),
      update: jest.fn().mockResolvedValue(current),
      create: jest.fn(),
    },
  };
  return { tx, salon, artist, current };
}

describe('Internal booking write policy', () => {
  it('locks the salon before reading eligibility and availability', async () => {
    const { tx } = fixture();
    await validateInternalBooking(tx, data, true);
    expect(tx.$queryRaw.mock.calls[0][0].join('')).toContain(
      '"User" WHERE id =  FOR UPDATE',
    );
    expect(tx.$queryRaw.mock.calls[0][1]).toBe('salon');
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.user.findUnique.mock.invocationCallOrder[0],
    );
    expect(tx.appointment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['PENDING', 'CONFIRMED'] },
          start: { lt: data.end },
          end: { gt: data.start },
          OR: [
            { tatoueurId: 'artist' },
            { tatoueurId: null, performerUserId: null },
          ],
        }),
      }),
    );
    expect(tx.blockedTimeSlot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ tatoueurId: null }, { tatoueurId: 'artist' }],
        }),
      }),
    );
  });
  it.each([
    'HIDDEN',
    'FREE',
    'EXPIRED',
    'elapsed',
    'trial',
    'prestation',
    'role',
    'missingArtist',
    'disabled',
    'closed',
    'malformed',
    'outside',
    'past',
    'noArtist',
  ])('rejects ineligible public booking: %s', async (reason) => {
    const { tx, salon, artist } = fixture();
    const booking = { ...data };
    if (reason === 'HIDDEN') salon.publicVisibility = 'HIDDEN';
    if (reason === 'FREE') salon.saasPlan = 'FREE';
    if (reason === 'EXPIRED') salon.saasPlanDetails.planStatus = 'EXPIRED';
    if (reason === 'elapsed')
      Object.assign(salon, { saasPlanUntil: new Date('2020-01-01') });
    if (reason === 'trial')
      Object.assign(salon.saasPlanDetails, {
        planStatus: 'TRIAL',
        trialEndDate: new Date('2020-01-01'),
      });
    if (reason === 'prestation') salon.prestations = [];
    if (reason === 'role') salon.role = 'client';
    if (reason === 'missingArtist')
      tx.tatoueur.findFirst.mockResolvedValue(null);
    if (reason === 'disabled') artist.rdvBookingEnabled = false;
    if (reason === 'closed') artist.hours = '{}';
    if (reason === 'malformed') artist.hours = '{';
    if (reason === 'outside') booking.end = new Date('2030-02-15T18:00:00Z');
    if (reason === 'past') {
      booking.start = new Date('2020-02-15T09:00:00Z');
      booking.end = new Date('2020-02-15T10:00:00Z');
    }
    if (reason === 'noArtist') booking.tatoueurId = '';
    await expect(
      validateInternalBooking(tx, booking, true),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.appointment.create).not.toHaveBeenCalled();
  });
  it('allows manual appointments outside public hours and for a disabled public artist', async () => {
    const { tx, artist } = fixture();
    artist.hours = '{}';
    artist.rdvBookingEnabled = false;
    await expect(
      validateInternalBooking(tx, data, false),
    ).resolves.toBeUndefined();
  });
  it('uses the selected artist hours rather than salon hours', async () => {
    const { tx, salon } = fixture();
    salon.salonHours = '{}';
    await expect(
      validateInternalBooking(tx, data, true),
    ).resolves.toBeUndefined();
  });
  it.each(['invalid', 'zero', 'negative'])(
    'rejects invalid interval: %s',
    async (reason) => {
      const { tx } = fixture();
      const end =
        reason === 'invalid'
          ? new Date('invalid')
          : reason === 'zero'
            ? data.start
            : new Date('2020-01-01');
      await expect(
        validateInternalBooking(tx, { ...data, end }, false),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );
  it.each([true, false])(
    'rejects blocks and conflicts even for manual bookings: public=%s',
    async (publicBooking) => {
      const { tx } = fixture();
      tx.blockedTimeSlot.findFirst.mockResolvedValue({ id: 'block' });
      await expect(
        validateInternalBooking(tx, data, publicBooking),
      ).rejects.toBeInstanceOf(ConflictException);
      tx.blockedTimeSlot.findFirst.mockResolvedValue(null);
      tx.appointment.findFirst.mockResolvedValue({ id: 'other' });
      await expect(
        validateInternalBooking(tx, data, publicBooking),
      ).rejects.toBeInstanceOf(ConflictException);
    },
  );
  it('checks every artist and every block in GLOBAL mode', async () => {
    const { tx, salon } = fixture();
    salon.role = 'user_tatoueur';
    await validateInternalBooking(tx, data, true);
    expect(tx.appointment.findFirst.mock.calls[0][0].where).not.toHaveProperty(
      'OR',
    );
    expect(
      tx.blockedTimeSlot.findFirst.mock.calls[0][0].where,
    ).not.toHaveProperty('OR');
  });
  it('propagates database errors instead of treating the slot as available', async () => {
    const { tx } = fixture();
    tx.appointment.findFirst.mockRejectedValue(new Error('unavailable'));
    await expect(validateInternalBooking(tx, data, true)).rejects.toThrow(
      'unavailable',
    );
  });
  it('rechecks the current owner and client after locking an update', async () => {
    const { tx, current } = fixture();
    current.clientUserId = 'someone-else';
    await expect(
      updateInternalBooking(
        tx,
        { where: { id: current.id }, data: { start: data.start } },
        'salon',
        'client',
        true,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.appointment.update).not.toHaveBeenCalled();
  });
  it('cannot move a cancelled appointment as a client', async () => {
    const { tx, current } = fixture();
    current.status = 'CANCELED';
    await expect(
      updateInternalBooking(
        tx,
        { where: { id: current.id }, data: {} },
        'salon',
        'client',
        true,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('excludes only the updated appointment from the conflict check', async () => {
    const { tx } = fixture();
    await updateInternalBooking(
      tx,
      { where: { id: 'appointment' }, data: { end: data.end } },
      'salon',
      'client',
      true,
    );
    expect(tx.appointment.findFirst.mock.calls[0][0].where.id).toEqual({
      not: 'appointment',
    });
    expect(tx.appointment.update).toHaveBeenCalledTimes(1);
  });
});

describe('Paris booking calendar independent of server timezone', () => {
  it.each([
    ['2030-02-15', '08:00:00.000Z'],
    ['2030-07-15', '07:00:00.000Z'],
  ])('converts opening hours for %s', (day, expected) => {
    expect(
      bookingHoursWindow(
        new Date(`${day}T12:00:00Z`),
        hours(),
      )?.start.toISOString(),
    ).toBe(`${day}T${expected}`);
  });
  it.each([
    ['2030-03-31', 2],
    ['2030-10-27', 4],
  ])('handles daylight saving transition %s', (day, duration) => {
    const window = bookingHoursWindow(
      new Date(`${day}T12:00:00Z`),
      hours('01:00', '04:00'),
    )!;
    expect((window.end.getTime() - window.start.getTime()) / 3600000).toBe(
      duration,
    );
  });
  it('supports midnight as the exclusive end of the day', () => {
    expect(
      bookingHoursWindow(
        data.start,
        hours('09:00', '24:00'),
      )?.end.toISOString(),
    ).toBe('2030-02-15T23:00:00.000Z');
  });
  it.each([
    '{}',
    '{',
    'null',
    '[]',
    hours('25:00', '26:00'),
    hours('18:00', '09:00'),
  ])('fails closed for malformed hours %s', (value) => {
    expect(bookingHoursWindow(data.start, value)).toBeNull();
  });
});

describe('Availability reads and block writes', () => {
  it('uses the Paris window when listing public slots', async () => {
    const { tx } = fixture();
    const slots = await new TimeSlotService(tx).generateTimeSlotsForDate(
      data.start,
      hours('09:00', '10:00'),
    );
    expect(slots).toEqual([
      {
        start: new Date('2030-02-15T08:00:00Z'),
        end: new Date('2030-02-15T08:30:00Z'),
      },
      {
        start: new Date('2030-02-15T08:30:00Z'),
        end: new Date('2030-02-15T09:00:00Z'),
      },
    ]);
  });
  it('includes artist-specific blocks in GLOBAL availability', async () => {
    const { tx, salon } = fixture();
    salon.role = 'user_tatoueur';
    await new TimeSlotService(tx).generateTimeSlotsForDate(
      data.start,
      hours('09:00', '09:30'),
      'salon',
    );
    const where = tx.blockedTimeSlot.findFirst.mock.calls[0][0].where;
    expect(where.userId).toBe('salon');
    expect(where).not.toHaveProperty('tatoueurId');
    expect(where).not.toHaveProperty('OR');
  });
  it.each([false, true])(
    'locks and rechecks the artist before creating a block: foreign=%s',
    async (foreign) => {
      const { tx } = fixture();
      tx.$transaction = (work: (db: any) => Promise<any>) => work(tx);
      tx.blockedTimeSlot.create = jest.fn().mockResolvedValue({ id: 'block' });
      if (foreign) tx.tatoueur.findFirst.mockResolvedValue(null);
      const result = await new BlockedTimeSlotsService(tx).createBlockedSlot(
        {
          startDate: data.start.toISOString(),
          endDate: data.end.toISOString(),
          tatoueurId: 'artist',
          reason: 'Unavailable',
        },
        'salon',
      );
      expect(result.error).toBe(foreign);
      expect(tx.tatoueur.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'artist', userId: 'salon' } }),
      );
      if (foreign) expect(tx.blockedTimeSlot.create).not.toHaveBeenCalled();
      else
        expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
          tx.blockedTimeSlot.create.mock.invocationCallOrder[0],
        );
    },
  );
});

// Transaction double models PostgreSQL row-lock ordering. Actual PostgreSQL
// concurrency remains an explicit pre-production check.
describe('Concurrent internal persistence through ResidenciesService', () => {
  it.each([
    ['same artist', false, false, 1],
    ['different artists', true, false, 2],
    ['global calendar', true, true, 1],
  ])(
    '%s: serializes the final availability check',
    async (_label, different, global, expected) => {
      const { tx, salon } = fixture();
      if (global) salon.role = 'user_tatoueur';
      const rows: any[] = [];
      let tail = Promise.resolve();
      const prisma: any = {
        $transaction: async (work: (db: any) => Promise<any>) => {
          let release: (() => void) | undefined;
          const db = {
            ...tx,
            $queryRaw: async (sql: TemplateStringsArray) => {
              if (!sql.join('').includes('"User"') || release) return;
              const previous = tail;
              tail = new Promise<void>((resolve) => {
                release = resolve;
              });
              await previous;
            },
            appointment: {
              findFirst: async ({ where }: any) =>
                rows.find(
                  (row) =>
                    where.status.in.includes(row.status) &&
                    row.start < where.start.lt &&
                    row.end > where.end.gt &&
                    (!where.OR ||
                      where.OR.some((scope: any) =>
                        Object.entries(scope).every(
                          ([key, value]) => row[key] === value,
                        ),
                      )),
                ) || null,
              create: async ({ data: value }: any) => {
                rows.push({
                  ...value,
                  performerUserId: null,
                  status: 'PENDING',
                });
                return value;
              },
            },
          };
          try {
            return await work(db);
          } finally {
            release?.();
          }
        },
      };
      const service = new ResidenciesService(prisma, {} as any);
      const results = await Promise.allSettled([
        service.persistAppointment(
          { data: { ...data, title: 'A' } },
          null,
          true,
        ),
        service.persistAppointment(
          {
            data: {
              ...data,
              tatoueurId: different ? 'other-artist' : 'artist',
              title: 'B',
            },
          },
          null,
          true,
        ),
      ]);
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(expected);
      expect(rows).toHaveLength(expected);
      if (expected === 1)
        expect(
          (
            results.find(
              (result) => result.status === 'rejected',
            ) as PromiseRejectedResult
          ).reason,
        ).toBeInstanceOf(ConflictException);
    },
  );
});
