import { BadRequestException } from '@nestjs/common';
import { DesiredTattooPeriod } from '@prisma/client';
import { DesiredTattooPeriodDto } from './dto/desired-tattoo-period.dto';

export function dateOnly(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new BadRequestException({
      code: 'INVALID_DATE',
      message: 'Date civile invalide (YYYY-MM-DD attendu).',
    });
  return date;
}

export const desiredPeriodSelect = {
  desiredTattooPeriod: true,
  desiredTattooDate: true,
  desiredTattooStartDate: true,
  desiredTattooEndDate: true,
} as const;

/** A supplied preference replaces the whole preference; omission preserves it. */
export function desiredPeriodData(
  input: DesiredTattooPeriodDto,
  prestation: string,
) {
  if (!Object.keys(desiredPeriodSelect).some((key) => input[key] !== undefined))
    return {};
  const fail = () => {
    throw new BadRequestException({
      code: 'INVALID_DESIRED_PERIOD',
      message: 'Période souhaitée incohérente ou réservée aux RDV PROJET.',
    });
  };
  const period = input.desiredTattooPeriod ?? null;
  const exact = input.desiredTattooDate ?? null;
  const from = input.desiredTattooStartDate ?? null;
  const to = input.desiredTattooEndDate ?? null;
  if (
    prestation !== 'PROJET' ||
    (period !== null && !Object.values(DesiredTattooPeriod).includes(period))
  )
    fail();
  if (
    period === 'EXACT_DATE'
      ? !exact || !!from || !!to
      : period === 'DATE_RANGE'
        ? !from || !to || !!exact
        : !!exact || !!from || !!to
  )
    fail();
  const data = {
    desiredTattooPeriod: period,
    desiredTattooDate: exact ? dateOnly(exact) : null,
    desiredTattooStartDate: from ? dateOnly(from) : null,
    desiredTattooEndDate: to ? dateOnly(to) : null,
  };
  if (
    data.desiredTattooStartDate &&
    data.desiredTattooEndDate &&
    data.desiredTattooStartDate > data.desiredTattooEndDate
  )
    fail();
  return data;
}
