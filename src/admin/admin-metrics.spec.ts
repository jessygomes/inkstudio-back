import { Role } from '@prisma/client';
import { AdminService } from './admin.service';

describe('Admin operational metrics', () => {
  afterEach(() => jest.useRealTimers());
  function setup() {
    const prisma = {
      user: { count: jest.fn().mockResolvedValue(3), findMany: jest.fn().mockResolvedValue([]) },
      appointment: { count: jest.fn().mockResolvedValue(5) },
      accountDeparture: { count: jest.fn().mockResolvedValue(2) },
      adminMetricTracking: { findUnique: jest.fn().mockResolvedValue({ startedAt: new Date('2026-10-10T00:00:00Z') }) },
    };
    const cache = { get: jest.fn().mockResolvedValue({ salons: [{ id: 'stale' }] }) };
    return { prisma, cache, service: new AdminService(prisma as never, cache as never, {} as never) };
  }
  it('keeps pending queue fresh rather than returning an outdated verification status', async () => {
    const { prisma, cache, service } = setup();
    await service.getSalonsWithPendingDocuments();
    expect(cache.get).not.toHaveBeenCalled();
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ verifiedSalon: true, SalonVerificationDocument: true }) }));
  });
  it('distinguishes untracked months from zero and retains year in period keys', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-24T12:00:00Z') });
    const { prisma, service } = setup();
    const result = await service.getMonthlyEvolution(12);
    expect(result.error).toBe(false);
    expect(result.data).toHaveLength(12);
    expect(result.data?.[0]).toMatchObject({ period: '2025-11', departures: null });
    expect(result.data?.[11]).toMatchObject({ period: '2026-10', departures: 2 });
    expect(prisma.accountDeparture.count).toHaveBeenCalledTimes(1);
    expect(prisma.accountDeparture.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ occurredAt: { gte: new Date('2026-10-10T00:00:00Z'), lt: new Date('2026-10-31T23:00:00Z') } }) }));
  });
  it('caps the query window and handles invalid numeric input', async () => {
    const { service } = setup();
    expect((await service.getMonthlyEvolution(999)).data).toHaveLength(24);
    expect((await service.getMonthlyEvolution(NaN)).data).toHaveLength(6);
    expect((await service.getMonthlyEvolution(-1)).data).toHaveLength(1);
  });
  it('does not fabricate historical departures if tracking has not been initialized', async () => {
    const { prisma, service } = setup();
    prisma.adminMetricTracking.findUnique.mockResolvedValue(null as never);
    expect((await service.getMonthlyEvolution(1)).data?.[0].departures).toBeNull();
    expect(prisma.accountDeparture.count).not.toHaveBeenCalled();
  });
});

describe('Anonymous departure recording', () => {
  function setup(role: Role, fail = false) {
    const events: string[] = [];
    const departure = jest.fn(async () => { events.push('departure'); return {}; });
    const deletion = jest.fn(async () => { events.push('delete'); if (fail) throw new Error('rollback'); return {}; });
    const tx = new Proxy({}, { get: (_, model) => model === 'accountDeparture' ? { create: departure } : {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }), deleteMany: jest.fn().mockResolvedValue({ count: 0 }), findMany: jest.fn().mockResolvedValue([]), delete: deletion,
    } });
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ id: 'private-id', email: 'private@example.com', role }) }, $transaction: jest.fn(async (work: (tx: unknown) => unknown) => work(tx)) };
    const service = new AdminService(prisma as never, { del: jest.fn(), delPattern: jest.fn() } as never, {} as never);
    return { service, prisma, departure, deletion, events };
  }
  it.each([Role.user_salon, Role.user_tatoueur, Role.user])('records %s in the deletion transaction without identity data', async role => {
    const { service, prisma, departure, events } = setup(role);
    expect((await service.deleteUserAndDependencies('private-id', 'admin-id')).error).toBe(false);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(departure).toHaveBeenCalledWith({ data: { role, source: 'ADMIN_DELETION' } });
    expect(events).toEqual(['departure', 'delete']);
  });
  it('does not count a client deletion as a professional departure', async () => {
    const { service, departure } = setup(Role.client);
    await service.deleteUserAndDependencies('private-id', 'admin-id');
    expect(departure).not.toHaveBeenCalled();
  });
  it('propagates a failed deletion out of the transaction for database rollback', async () => {
    const { service } = setup(Role.user_salon, true);
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try { expect((await service.deleteUserAndDependencies('private-id', 'admin-id')).error).toBe(true); }
    finally { errorLog.mockRestore(); }
  });
});
