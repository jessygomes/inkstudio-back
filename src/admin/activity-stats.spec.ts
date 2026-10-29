import { activityDateRange, getActivityStats } from './activity-stats';
import { PrismaService } from 'src/database/prisma.service';

describe('admin activity statistics', () => {
  it('uses Paris boundaries across the March daylight saving change', () => {
    expect(activityDateRange({ year: '2026', month: '3' })).toEqual({
      gte: new Date('2026-02-28T23:00:00Z'), lt: new Date('2026-03-31T22:00:00Z'),
    });
  });
  it('handles December and full years with exclusive end dates', () => {
    expect(activityDateRange({ year: '2026', month: '12' })?.lt).toEqual(new Date('2026-12-31T23:00:00Z'));
    expect(activityDateRange({ year: '2026' })).toEqual({ gte: new Date('2025-12-31T23:00:00Z'), lt: new Date('2026-12-31T23:00:00Z') });
    expect(activityDateRange({})).toBeUndefined();
  });
  it.each([{ month: '3' }, { year: 'oops' }, { year: '2026', month: '13' }, { year: '2026', month: '1.5' }])('rejects invalid date filters %j', (query) => {
    expect(() => activityDateRange(query)).toThrow();
  });
  it('keeps global totals, scopes professional records, and counts shared boards by publication', async () => {
    const prisma = {
      appointment: { count: jest.fn().mockReturnValueOnce(100).mockReturnValueOnce(4) },
      client: { count: jest.fn().mockReturnValueOnce(80).mockReturnValueOnce(3) },
      moodboard: { count: jest.fn().mockReturnValueOnce(50).mockReturnValueOnce(20).mockReturnValueOnce(7), groupBy: jest.fn().mockReturnValue([
        { projectStatus: 'OPEN', _count: { _all: 5 } }, { projectStatus: 'PRIVATE', _count: { _all: 2 } },
      ]) },
      $transaction: jest.fn((queries) => Promise.all(queries)),
    };
    const query = { year: '2026', month: '3', role: 'user_salon', accountId: 'salon-1', status: 'PRIVATE' };
    const result = await getActivityStats(prisma as unknown as PrismaService, query);
    expect(result.totals).toEqual({ appointments: 100, clientRecords: 80, moodboards: 50, sharedMoodboards: 20 });
    expect(result.filtered).toEqual({ appointments: 4, clientRecords: 3, moodboards: 7, sharedMoodboards: 2 });
    expect(prisma.appointment.count).toHaveBeenLastCalledWith({ where: { user: { is: { id: 'salon-1', role: { in: ['user', 'user_salon'] } } }, createdAt: activityDateRange(query) } });
    expect(prisma.moodboard.groupBy.mock.calls[0][0].where).toEqual({ publishedAt: activityDateRange(query) });
    expect(prisma.moodboard.count).toHaveBeenLastCalledWith({ where: { createdAt: activityDateRange(query) } });
    expect(result.sharedByStatus).toHaveLength(2);
  });
});
