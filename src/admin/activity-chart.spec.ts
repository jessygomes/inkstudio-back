import { fillActivitySeries, getActivityChart } from './activity-chart';
import { PrismaService } from 'src/database/prisma.service';

describe('activity charts', () => {
  it('fills missing months and leap-year days with zero', () => {
    const months = fillActivitySeries([{ period: '2026-03', count: 4n }], { year: '2026' });
    expect(months).toHaveLength(12);
    expect(months[2]).toEqual({ period: '2026-03', count: 4 });
    expect(months[0].count).toBe(0);
    expect(fillActivitySeries([], { year: '2024', month: '2' })).toHaveLength(29);
    expect(fillActivitySeries([], { year: '2026', month: '02' })).toHaveLength(28);
  });
  it('fills missing years without losing older data', () => {
    const series = fillActivitySeries([{ period: '2020', count: 2n }, { period: '2022', count: 3n }], {});
    expect(series[0]).toEqual({ period: '2020', count: 2 });
    expect(series[1]).toEqual({ period: '2021', count: 0 });
    expect(series.reduce((sum, row) => sum + row.count, 0)).toBe(5);
  });
  function mock() {
    return {
      appointment: { count: jest.fn(() => 100) }, client: { count: jest.fn(() => 80) }, moodboard: { count: jest.fn(() => 50) },
      $queryRaw: jest.fn((_sql: unknown) => [{ period: '2026-03', count: 4n }]),
      $transaction: jest.fn((queries) => Promise.all(queries)),
    };
  }
  it('binds account and role filters to professional charts and preserves global totals', async () => {
    const prisma = mock();
    const result = await getActivityChart(prisma as unknown as PrismaService, { metric: 'appointments', year: '2026', role: 'user_salon', accountId: 'account-1' });
    expect(result.total).toBe(100);
    expect(result.selected).toBe(4);
    expect(result.series).toHaveLength(12);
    const sql = prisma.$queryRaw.mock.calls[0][0] as { sql: string; values: unknown[] };
    expect(sql.sql).toContain('JOIN "User"');
    expect(sql.sql).not.toContain('account-1');
    expect(sql.values).toEqual(expect.arrayContaining(['account-1', 'user', 'user_salon']));
  });
  it('groups shared moodboards by publication and binds their own status filter', async () => {
    const prisma = mock();
    await getActivityChart(prisma as unknown as PrismaService, { metric: 'sharedMoodboards', year: '2026', status: 'OPEN' });
    const sql = prisma.$queryRaw.mock.calls[0][0] as { sql: string; values: unknown[] };
    expect(sql.sql).toContain('t."publishedAt"');
    expect(sql.sql).not.toContain('JOIN "User"');
    expect(sql.values).toContain('OPEN');
    expect(prisma.moodboard.count).toHaveBeenCalledWith({ where: { publishedAt: { not: null } } });
  });
  it.each([{ metric: 'nope' }, { metric: 'moodboards', accountId: 'account' }, { metric: 'appointments', status: 'OPEN' }])('rejects filters unrelated to the metric: %j', async (query) => {
    await expect(getActivityChart(mock() as unknown as PrismaService, query)).rejects.toThrow();
  });
});
