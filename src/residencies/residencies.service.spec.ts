import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ResidenciesService } from './residencies.service';

describe('Salon residencies', () => {
  let service: ResidenciesService;
  let db: any;
  const schedule = [{ day: 1, start: '09:00', end: '18:00' }];
  const member = {
    id: 'r1',
    salonId: 'paris',
    artistId: 'artist',
    endedAt: null,
    presence: { type: 'recurring', days: [1] },
    schedule,
    pendingSchedule: schedule,
    salonApproved: true,
    artistApproved: false,
    salonAllowsArtistCreate: true,
    salonAllowsArtistManage: true,
    salonAllowsPublicBooking: true,
    artistAllowsPublicBooking: true,
    artistAllowsSalonView: true,
    artistAllowsSalonManage: false,
    artistAllowsSalonCreate: false,
  };
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-26T12:00:00Z'));
    db = {
      salonResidency: {
        findFirst: jest.fn().mockResolvedValue({ ...member }),
        findMany: jest.fn().mockResolvedValue([{ ...member }]),
        update: jest.fn().mockImplementation((a) => a.data),
      },
      appointment: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation((a) => a.data),
        update: jest.fn().mockImplementation((a) => a.data),
        findUniqueOrThrow: jest.fn(),
      },
      blockedTimeSlot: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      user: {
        update: jest.fn().mockImplementation((a) => a.data),
        updateMany: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'paris',
          salonName: 'Paris',
          address: '1 rue de Paris',
          city: 'Paris',
          postalCode: '75000',
          salonHours: JSON.stringify({
            monday: { start: '09:00', end: '18:00' },
          }),
        }),
      },
      $queryRaw: jest.fn(),
    };
    db.$transaction = jest.fn((callback) => callback(db));
    service = new ResidenciesService(db, { delPattern: jest.fn() } as any);
  });
  afterEach(() => jest.useRealTimers());
  it('lists both authorized Business salons even when one has no presence configured', async () => {
    db.user.findUnique.mockResolvedValue({ saasPlan: 'FREE' });
    db.salonResidency.findMany.mockResolvedValue([
      { ...member, salon: { id: 'paris', role: 'user_salon', saasPlan: 'BUSINESS' } },
      { ...member, id: 'r2', salonId: 'raven', presence: null, salon: { id: 'raven', role: 'user_salon', saasPlan: 'BUSINESS' } },
    ]);
    const salons = await service.publicSalons('artist');
    expect(salons).toHaveLength(2);
    expect(salons).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'paris', publicBookingEnabled: true }),
      expect.objectContaining({ id: 'raven', publicBookingEnabled: true }),
    ]));
  });

  it('preserves an artist’s historical appointments while hiding them in FREE and revealing them in PRO', async () => {
    db.appointment.findUnique.mockResolvedValue({ userId: 'paris', performerUserId: 'artist', venueSalonId: 'paris' });
    db.user.findUnique.mockResolvedValue({ role: 'user_tatoueur', saasPlan: 'FREE' });
    expect(await service.visibleAppointmentsWhere('artist')).toEqual({ id: { in: [] } });
    await expect(service.assertAppointmentAccess('a1','artist',false)).rejects.toThrow(ForbiddenException);
    db.user.findUnique.mockResolvedValue({ role: 'user_tatoueur', saasPlan: 'PRO' });
    expect(await service.visibleAppointmentsWhere('artist')).toEqual({ OR: [{userId:'artist'}, {performerUserId:'artist'}] });
    await expect(service.assertAppointmentAccess('a1','artist',false)).resolves.toBeUndefined();
    expect(db.appointment.update).not.toHaveBeenCalled();
  });
  it('rechecks Business sponsorship and salon ownership when saving a FREE artist appointment', async () => {
    db.user.findUnique.mockResolvedValue({saasPlan:'FREE'});
    db.salonResidency.findFirst.mockResolvedValue({...member, salon:{ id:'paris', role:'user_salon', saasPlan:'BUSINESS' }});
    const data = { userId:'paris', performerUserId:'artist', venueSalonId:'paris', start:new Date('2026-11-02T09:00Z'), end:new Date('2026-11-02T10:00Z') };
    await expect(service.persistAppointment({data} as any,null,true)).resolves.toMatchObject({userId:'paris',performerUserId:'artist'});
    await expect(service.persistAppointment({data:{...data,userId:'artist'}} as any,null,true)).rejects.toThrow(ForbiddenException);
    db.salonResidency.findFirst.mockResolvedValue({...member, salon:{ id:'paris', role:'user_salon', saasPlan:'PRO' }});
    await expect(service.persistAppointment({data} as any,null,true)).rejects.toThrow(ForbiddenException);
  });
  it('cannot sponsor a FREE artist at an unrelated salon or without both public permissions', async () => {
    db.salonResidency.findFirst.mockResolvedValue(null);
    await expect(service.businessSponsor('artist','paris')).rejects.toThrow(ForbiddenException);
    await expect(service.businessSponsor('artist',undefined)).rejects.toThrow(ForbiddenException);
    db.salonResidency.findFirst.mockResolvedValue({...member, artistAllowsPublicBooking:false, salon:{ id:'paris', role:'user_salon', saasPlan:'BUSINESS' }});
    await expect(service.businessSponsor('artist','paris')).rejects.toThrow(ForbiddenException);
  });
  it('allows legacy salons to be configured one at a time when another has no presence yet', async () => {
    db.salonResidency.findMany.mockResolvedValue([{ ...member, id: 'legacy', salonId: 'legacy', presence: null }]);
    const legacyBooking = { venueSalonId: 'legacy', start: new Date('2026-11-03T09:00Z'), end: new Date('2026-11-03T10:00Z') };
    db.appointment.findMany.mockImplementation(({ where }) => Promise.resolve([legacyBooking].filter(a => where.venueSalonId.in.includes(a.venueSalonId))));
    await expect(service.setPresence('r1', 'artist', { type: 'recurring', days: [1] })).resolves.toMatchObject({ presence: { type: 'recurring', days: [1] } });
  });
  it('shows the correct current salon to a salon even when a dated stay is elsewhere', async () => {
    const own = {
      ...member,
      presence: { type: 'daily' },
      artist: {},
      salon: {},
    };
    const stay = {
      ...member,
      id: 'lyon',
      salonId: 'lyon',
      presence: {
        type: 'period',
        startDate: '2026-10-26',
        endDate: '2026-11-02',
      },
    };
    db.salonResidency.findMany
      .mockResolvedValueOnce([own])
      .mockResolvedValueOnce([own, stay]);
    const result = await service.list('paris');
    expect(result.residencies).toHaveLength(1);
    expect(result.residencies[0].isCurrentSalon).toBe(false);
  });
  it('returns to automatic presence when a manual selection expires', async () => {
    db.salonResidency.findMany.mockResolvedValue([
      { ...member, salon: {} },
      {
        ...member,
        id: 'toulouse',
        salonId: 'toulouse',
        presence: { type: 'recurring', days: [2, 3] },
        salon: {},
      },
    ]);
    db.user.findUnique.mockResolvedValue({
      currentResidencyId: 'toulouse',
      currentResidencyUntil: new Date('2026-10-26T23:00Z'),
    });
    expect((await service.publicSalons('artist'))[0]).toMatchObject({
      residencyId: 'toulouse',
      isCurrentSalon: true,
      currentSalonMode: 'manual',
    });
    jest.setSystemTime(new Date('2026-10-26T23:00Z'));
    expect((await service.publicSalons('artist'))[0]).toMatchObject({
      residencyId: 'toulouse',
      isCurrentSalon: true,
      currentSalonMode: 'automatic',
    });
  });
  it('protects a booking in another salon when a dated stay would override its recurring days', async () => {
    db.salonResidency.findMany.mockResolvedValue([
      {
        ...member,
        id: 'toulouse',
        salonId: 'toulouse',
        presence: { type: 'recurring', days: [1, 2, 3] },
      },
    ]);
    db.appointment.findMany.mockResolvedValue([
      {
        venueSalonId: 'toulouse',
        start: new Date('2026-11-02T09:00Z'),
        end: new Date('2026-11-02T10:00Z'),
      },
    ]);
    await expect(
      service.setPresence('r1', 'artist', {
        type: 'period',
        startDate: '2026-11-01',
        endDate: '2026-11-04',
      }),
    ).rejects.toThrow(ConflictException);
  });
  it('distinguishes view permission from manage permission for a salon', async () => {
    db.appointment.findUnique.mockResolvedValue({
      performerUserId: 'artist',
      venueSalonId: 'paris',
      userId: 'artist',
    });
    await expect(
      service.assertAppointmentAccess('a1', 'paris', false),
    ).resolves.toBeUndefined();
    await expect(
      service.assertAppointmentAccess('a1', 'paris', true),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.assertAppointmentAccess('a1', 'london', false),
    ).rejects.toThrow(ForbiddenException);
  });
  it('preserves the stored address on rescheduling and checks manage rather than create permission', async () => {
    const existing = {
      id: 'a1',
      userId: 'artist',
      performerUserId: 'artist',
      venueSalonId: 'paris',
      venueAddress: 'Old address',
      start: new Date('2026-11-02T09:00Z'),
      end: new Date('2026-11-02T10:00Z'),
    };
    db.appointment.findUnique.mockResolvedValue(existing);
    db.appointment.findUniqueOrThrow.mockResolvedValue(existing);
    db.salonResidency.findMany.mockResolvedValue([
      { ...member, salonAllowsArtistCreate: false },
    ]);
    const data = {
      start: new Date('2026-11-02T10:00Z'),
      end: new Date('2026-11-02T11:00Z'),
    };
    await service.updateAppointment({ where: { id: 'a1' }, data }, 'artist');
    expect(db.appointment.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data,
    });
  });
  it('prevents either party from changing the other party’s grants', async () => {
    await expect(
      service.updatePermissions('r1', 'artist', {
        salonAllowsPublicBooking: true,
      }),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.updatePermissions('r1', 'paris', { artistAllowsSalonView: true }),
    ).rejects.toThrow(ForbiddenException);
    expect(db.salonResidency.update).not.toHaveBeenCalled();
  });
  it('lets the artist save presence immediately, without approval or hours', async () => {
    db.salonResidency.findMany.mockResolvedValue([]);
    await service.setPresence('r1', 'artist', {
      type: 'recurring',
      days: [1, 3],
    });
    expect(db.salonResidency.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          presence: { type: 'recurring', days: [1, 3] },
          salonApproved: false,
          artistApproved: false,
        }),
      }),
    );
  });
  it('does not let the salon change an artist’s presence', async () => {
    await expect(
      service.setPresence('r1', 'paris', { type: 'daily' }),
    ).rejects.toThrow(ForbiddenException);
    expect(db.salonResidency.update).not.toHaveBeenCalled();
  });
  it('rejects conflicting days and protects bookings at any affected salon', async () => {
    await expect(
      service.setPresence('r1', 'artist', { type: 'recurring', days: [1] }),
    ).rejects.toThrow(ConflictException);
    db.salonResidency.findMany.mockResolvedValue([]);
    db.appointment.findMany.mockResolvedValue([
      {
        venueSalonId: 'paris',
        start: new Date('2026-11-03T09:00Z'),
        end: new Date('2026-11-03T10:00Z'),
      },
    ]);
    await expect(
      service.setPresence('r1', 'artist', { type: 'recurring', days: [1] }),
    ).rejects.toThrow(ConflictException);
  });
  it('uses personal artist hours and never constrains bookings to salon hours', async () => {
    db.user.findUniqueOrThrow.mockImplementation(({ where }) =>
      Promise.resolve({
        id: where.id,
        salonHours: JSON.stringify({
          monday:
            where.id === 'artist' ? { start: '09:00', end: '18:00' } : null,
        }),
      }),
    );
    await expect(
      service.venueSnapshot(
        'artist',
        'artist',
        'paris',
        'artist',
        false,
        new Date('2026-11-02T09:00Z'),
        new Date('2026-11-02T10:00Z'),
      ),
    ).resolves.toMatchObject({ venueSalonId: 'paris' });
    await expect(
      service.venueSnapshot(
        'artist',
        'artist',
        'paris',
        'artist',
        false,
        new Date('2026-11-02T18:00Z'),
        new Date('2026-11-02T19:00Z'),
      ),
    ).rejects.toThrow(BadRequestException);
  });
  it('keeps a manual current salon only until the next planned change', async () => {
    db.user.findUniqueOrThrow.mockResolvedValue({ role: 'user_tatoueur' });
    db.salonResidency.findMany.mockResolvedValue([
      member,
      {
        ...member,
        id: 'r2',
        salonId: 'toulouse',
        presence: { type: 'recurring', days: [2, 3] },
      },
    ]);
    const result = await service.setCurrentSalon('artist', 'r2');
    expect(result.currentSalonUntil?.toISOString()).toBe(
      '2026-10-26T23:00:00.000Z',
    );
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          currentResidencyId: 'r2',
          currentResidencyUntil: new Date('2026-10-26T23:00Z'),
        },
      }),
    );
    await expect(
      service.setCurrentSalon('artist', 'not-my-salon'),
    ).rejects.toThrow(ForbiddenException);
  });
  it('requires a venue and both public booking permissions', async () => {
    await expect(
      service.venueSnapshot(
        'artist',
        'artist',
        undefined,
        null,
        true,
        new Date('2026-11-02T09:00Z'),
        new Date('2026-11-02T10:00Z'),
      ),
    ).rejects.toThrow(BadRequestException);
    db.salonResidency.findMany.mockResolvedValue([
      { ...member, artistAllowsPublicBooking: false },
    ]);
    await expect(
      service.venueSnapshot(
        'artist',
        'artist',
        'paris',
        null,
        true,
        new Date('2026-11-02T09:00Z'),
        new Date('2026-11-02T10:00Z'),
      ),
    ).rejects.toThrow(ForbiddenException);
  });
  it('checks global artist conflicts while holding the artist lock', async () => {
    db.appointment.findFirst.mockResolvedValue({ id: 'in-another-salon' });
    await expect(
      service.persistAppointment(
        {
          data: {
            userId: 'artist',
            performerUserId: 'artist',
            venueSalonId: 'paris',
            start: new Date('2026-11-02T09:00Z'),
            end: new Date('2026-11-02T10:00Z'),
          },
        } as any,
        'artist',
        false,
      ),
    ).rejects.toThrow(ConflictException);
    expect(db.$queryRaw).toHaveBeenCalled();
    expect(db.appointment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ userId: 'artist' }, { performerUserId: 'artist' }],
        }),
      }),
    );
    expect(db.appointment.create).not.toHaveBeenCalled();
  });
  it('freezes the venue on creation', async () => {
    const result = await service.persistAppointment(
      {
        data: {
          userId: 'artist',
          performerUserId: 'artist',
          venueSalonId: 'paris',
          start: new Date('2026-11-02T09:00Z'),
          end: new Date('2026-11-02T10:00Z'),
        },
      } as any,
      'artist',
      false,
    );
    expect(result).toMatchObject({
      venueSalonId: 'paris',
      venueAddress: '1 rue de Paris',
      venueCity: 'Paris',
    });
  });
  it('reuses the enclosing booking transaction instead of committing the artist appointment separately', async () => {
    const result = await service.persistAppointment({ data: {
      userId: 'artist', performerUserId: 'artist', venueSalonId: 'paris',
      start: new Date('2026-11-02T09:00Z'), end: new Date('2026-11-02T10:00Z'),
    } } as any, 'artist', false, db);
    expect(result).toMatchObject({ venueSalonId: 'paris', performerUserId: 'artist' });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.$queryRaw).toHaveBeenCalled();
    expect(db.appointment.create).toHaveBeenCalledTimes(1);
  });
  it('does not permit leaving a salon with upcoming appointments', async () => {
    db.appointment.count.mockResolvedValue(2);
    await expect(service.leave('r1', 'artist')).rejects.toThrow(
      ConflictException,
    );
    expect(db.salonResidency.update).not.toHaveBeenCalled();
  });
  it('filters slots against global bookings and salon closures in bulk', async () => {
    db.appointment.findMany.mockResolvedValue([
      {
        start: new Date('2026-11-02T08:00Z'),
        end: new Date('2026-11-02T09:00Z'),
      },
    ]);
    const result = await service.slots('artist', 'paris', '2026-11-02');
    expect(
      result.some((s) => s.start.toISOString() === '2026-11-02T08:00:00.000Z'),
    ).toBe(false);
    expect(
      result.some((s) => s.start.toISOString() === '2026-11-02T09:00:00.000Z'),
    ).toBe(true);
    expect(db.appointment.findMany).toHaveBeenCalledTimes(1);
  });
});
