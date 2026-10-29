import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';
import { activityDateRange, type ActivityQuery } from './activity-stats';

type Metric = 'appointments' | 'clientRecords' | 'moodboards' | 'sharedMoodboards';
type SeriesRow = { period: string; count: bigint | number };
export interface ActivityChartQuery extends ActivityQuery { metric?: string }

export function fillActivitySeries(rows: SeriesRow[], query: ActivityQuery) {
  const values = new Map(rows.map(row => [row.period, Number(row.count)]));
  if (query.year) {
    const count = query.month ? new Date(Date.UTC(+query.year, +query.month, 0)).getUTCDate() : 12;
    return Array.from({ length: count }, (_, i) => {
      const period = `${query.year}-${query.month ? `${query.month.padStart(2, '0')}-` : ''}${String(i + 1).padStart(2, '0')}`;
      return { period, count: values.get(period) ?? 0 };
    });
  }
  const currentYear = Number(new Intl.DateTimeFormat('en', { timeZone: 'Europe/Paris', year: 'numeric' }).format(new Date()));
  const firstYear = rows.length ? Math.min(...rows.map(row => Number(row.period))) : currentYear;
  const lastYear = Math.max(currentYear, ...rows.map(row => Number(row.period)));
  return Array.from({ length: lastYear - firstYear + 1 }, (_, i) => {
    const period = String(firstYear + i);
    return { period, count: values.get(period) ?? 0 };
  });
}

export async function getActivityChart(prisma: PrismaService, query: ActivityChartQuery) {
  const metrics: Metric[] = ['appointments', 'clientRecords', 'moodboards', 'sharedMoodboards'];
  if (!metrics.includes(query.metric as Metric)) throw new BadRequestException('Indicateur invalide.');
  const dateRange = activityDateRange(query);
  const professional = query.metric === 'appointments' || query.metric === 'clientRecords';
  if (query.role && (!professional || !['user_salon', 'user_tatoueur'].includes(query.role))) throw new BadRequestException('Type de compte invalide.');
  if (query.accountId && (!professional || typeof query.accountId !== 'string' || query.accountId.length > 100)) throw new BadRequestException('Compte invalide.');
  if (query.status && (query.metric !== 'sharedMoodboards' || !['PRIVATE', 'OPEN', 'MATCHED', 'CLOSED'].includes(query.status))) throw new BadRequestException('Statut invalide.');

  // Identifiers are chosen exclusively from static SQL fragments; all filters are bound values.
  const table = query.metric === 'appointments' ? Prisma.sql`"Appointment"` : query.metric === 'clientRecords' ? Prisma.sql`"Client"` : Prisma.sql`"Moodboard"`;
  const date = query.metric === 'sharedMoodboards' ? Prisma.sql`t."publishedAt"` : Prisma.sql`t."createdAt"`;
  const grouping = query.month ? 'day' : query.year ? 'month' : 'year';
  const format = query.month ? 'YYYY-MM-DD' : query.year ? 'YYYY-MM' : 'YYYY';
  const conditions: Prisma.Sql[] = [Prisma.sql`${date} IS NOT NULL`];
  if (dateRange) conditions.push(Prisma.sql`${date} >= ${dateRange.gte as Date} AND ${date} < ${dateRange.lt as Date}`);
  if (professional) {
    const roles = query.role === 'user_tatoueur' ? ['user_tatoueur'] : query.role === 'user_salon' ? ['user', 'user_salon'] : ['user', 'user_salon', 'user_tatoueur'];
    conditions.push(Prisma.sql`u."role"::text IN (${Prisma.join(roles)})`);
    if (query.accountId) conditions.push(Prisma.sql`t."userId" = ${query.accountId}`);
  }
  if (query.status) conditions.push(Prisma.sql`t."projectStatus" = ${query.status}`);
  const grouped = prisma.$queryRaw<SeriesRow[]>(Prisma.sql`
    SELECT to_char(date_trunc(${grouping}, timezone('Europe/Paris', ${date} AT TIME ZONE 'UTC')), ${format}) AS period,
      COUNT(*)::bigint AS count
    FROM ${table} t
    ${professional ? Prisma.sql`JOIN "User" u ON u."id" = t."userId"` : Prisma.empty}
    WHERE ${Prisma.join(conditions, ' AND ')}
    GROUP BY 1 ORDER BY 1
  `);
  const totalQuery = query.metric === 'appointments' ? prisma.appointment.count()
    : query.metric === 'clientRecords' ? prisma.client.count()
    : prisma.moodboard.count({ where: query.metric === 'sharedMoodboards' ? { publishedAt: { not: null } } : {} });
  const [rows, total] = await prisma.$transaction([grouped, totalQuery], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  const series = fillActivitySeries(rows, query);
  return { total, selected: series.reduce((sum, row) => sum + row.count, 0), grouping, series };
}
