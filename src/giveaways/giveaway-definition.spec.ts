import { CRITERION_TYPES } from './giveaway-criteria';
import { giveawayOptions } from './giveaway-options';
import { BadRequestException } from '@nestjs/common';
import { GiveawayPrizeType, GiveawayStatus, SaasPlan } from '@prisma/client';
import { categoryCreateData, readConfig, validateDefinition } from './giveaway-definition';
import { effectiveStatus, entriesOpen, parisInstant, substantialLocked } from './giveaway-time';
import { inkera20262027Definition } from './inkera-2026-2027';

describe('Inkera 2026–2027 definition', () => {
  const def = inkera20262027Definition();

  it('uses Europe/Paris boundaries (UTC+1 in winter)', () => {
    expect(def.opensAt.toISOString()).toBe('2026-11-30T23:00:00.000Z');
    expect(def.closesAt.toISOString()).toBe('2027-01-07T22:59:59.999Z');
    expect(def.drawAt.toISOString()).toBe('2027-01-08T09:00:00.000Z');
  });

  it('is valid: 3 PRO 12 months for independents, 1 BUSINESS 12 months for salons, real plan ids', () => {
    expect(() => validateDefinition(def)).not.toThrow();
    const [indep, salon] = def.categories;
    expect(indep).toMatchObject({ key: 'independent', winnersCount: 3 });
    expect(indep.prizes[0]).toMatchObject({ plan: SaasPlan.PRO, durationMonths: 12, quantity: 3, commercialValueCents: 43188 });
    expect(salon).toMatchObject({ key: 'salon', winnersCount: 1 });
    expect(salon.prizes[0]).toMatchObject({ plan: SaasPlan.BUSINESS, durationMonths: 12, quantity: 1, commercialValueCents: 115188 });
    expect(categoryCreateData(def.categories, 'g')[0].prizes[0].giveawayId).toBe('g');
  });

  it('entry window boundaries', () => {
    const g = { status: GiveawayStatus.SCHEDULED, opensAt: def.opensAt, closesAt: def.closesAt, publishedAt: new Date('2026-11-01') };
    expect(entriesOpen(g, new Date('2026-11-30T22:59:59.999Z'))).toBe(false);
    expect(entriesOpen(g, new Date('2026-11-30T23:00:00.000Z'))).toBe(true);
    expect(entriesOpen(g, new Date('2027-01-07T22:59:59.999Z'))).toBe(true);
    expect(entriesOpen(g, new Date('2027-01-07T23:00:00.000Z'))).toBe(false);
    expect(effectiveStatus(g, new Date('2027-01-08T00:00:00Z'))).toBe(GiveawayStatus.CLOSED);
    expect(entriesOpen({ ...g, status: GiveawayStatus.DRAFT }, new Date('2026-12-15T12:00:00Z'))).toBe(false);
    expect(substantialLocked(g, new Date('2026-11-15T00:00:00Z'))).toBe(false);
    expect(substantialLocked(g, new Date('2026-12-01T00:00:00Z'))).toBe(true);
    expect(substantialLocked({ ...g, status: GiveawayStatus.DRAFT, publishedAt: null }, new Date('2026-12-15T00:00:00Z'))).toBe(false);
  });

  it('summer time is handled by the Paris helper', () => {
    expect(parisInstant('2027-07-01', 0, 0).toISOString()).toBe('2027-06-30T22:00:00.000Z');
  });
});

describe('validateDefinition', () => {
  const base = inkera20262027Definition();

  it('refuses prize quantity not matching winners', () => {
    const categories = [{ ...base.categories[0], winnersCount: 2 }];
    expect(() => validateDefinition({ ...base, categories })).toThrow(BadRequestException);
  });

  it('refuses BUSINESS for a category open to independents', () => {
    const categories = [{ ...base.categories[0], prizes: [{ ...base.categories[0].prizes[0], plan: SaasPlan.BUSINESS }] }];
    expect(() => validateDefinition({ ...base, categories })).toThrow(/Business/);
  });

  it('refuses a subscription prize without plan or duration, and unknown criteria', () => {
    const noPlan = [{ ...base.categories[0], prizes: [{ type: GiveawayPrizeType.SUBSCRIPTION_GRANT, label: 'x', quantity: 3 }] }];
    expect(() => validateDefinition({ ...base, categories: noPlan })).toThrow();
    const unknown = [{ ...base.categories[0], criteria: [{ type: 'ACCOUNT_TYPE', roles: ['user_tatoueur'] }, { type: 'NOPE' }] }];
    expect(() => validateDefinition({ ...base, categories: unknown })).toThrow(/inconnu/);
  });

  it('refuses a role present in two categories, missing ACCOUNT_TYPE and bad dates', () => {
    const twice = [base.categories[0], { ...base.categories[0], key: 'other' }];
    expect(() => validateDefinition({ ...base, categories: twice })).toThrow(/deux catégories/);
    const noType = [{ ...base.categories[0], criteria: [{ type: 'PUBLIC_PROFILE' }] }];
    expect(() => validateDefinition({ ...base, categories: noType })).toThrow(/ACCOUNT_TYPE/);
    expect(() => validateDefinition({ ...base, closesAt: base.opensAt })).toThrow();
    expect(() => validateDefinition({ ...base, drawAt: new Date('2027-01-01') })).toThrow();
  });

  it('config falls back to safe defaults', () => {
    expect(readConfig({ acceptanceDays: 999, retentionDays: 'x' } as never)).toEqual({ acceptanceDays: 14, retentionDays: 365, coverImageUrl: null, showPrizeValue: true });
  });

  it('display options: https visual only, explicit prize value switch', () => {
    expect(readConfig({ coverImageUrl: 'https://utfs.io/f/abc.jpg', showPrizeValue: false })).toMatchObject({ coverImageUrl: 'https://utfs.io/f/abc.jpg', showPrizeValue: false });
    expect(readConfig({ coverImageUrl: 'http://example.com/a.jpg' }).coverImageUrl).toBeNull();
    expect(readConfig({ coverImageUrl: 'javascript:alert(1)' }).coverImageUrl).toBeNull();
  });

  it('options catalog mirrors the whitelist and real plans', () => {
    const o = giveawayOptions();
    expect(o.criterionTypes).toEqual([...CRITERION_TYPES]);
    expect(o.plans.map((p) => p.plan)).toEqual(['PRO', 'BUSINESS']);
    expect(o.plans.find((p) => p.plan === 'BUSINESS')?.roles).toEqual(['user_salon']);
    expect(o.plans.every((p) => p.monthlyPrice > 0)).toBe(true);
  });
});
