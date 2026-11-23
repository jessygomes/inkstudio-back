import { categoryAppliesTo, CriteriaValidationError, evaluateCriteria, parseCriteria, ProfileFacts } from './giveaway-criteria';
import { inkera20262027Definition } from './inkera-2026-2027';

const fullFacts = (over: Partial<ProfileFacts> = {}): ProfileFacts => ({
  role: 'user_tatoueur',
  emailVerified: true,
  publicVisibility: 'VISIBLE',
  publicRouteReady: true,
  fields: { NAME: true, PROFILE_PHOTO: true, COVER_PHOTO: true, CITY: true, ADDRESS: true, POSTAL_CODE: true, DESCRIPTION: true, STYLE: true, HOURS: true, PRESTATIONS: true },
  contacts: { PHONE: true, INSTAGRAM: false, WEBSITE: false, FACEBOOK: false, TIKTOK: false },
  portfolioImages: 5,
  studioImages: 0,
  studioOrPortfolioImages: 5,
  ...over,
});

describe('giveaway criteria — validation', () => {
  it('refuses unknown criterion types instead of ignoring them', () => {
    expect(() => parseCriteria([{ type: 'RUN_SCRIPT', code: 'process.exit()' }])).toThrow(CriteriaValidationError);
  });

  it('refuses unknown keys, unknown fields and duplicates', () => {
    expect(() => parseCriteria([{ type: 'PUBLIC_PROFILE', extra: 1 }])).toThrow(/clé non autorisée/);
    expect(() => parseCriteria([{ type: 'PROFILE_FIELD_REQUIRED', fields: ['NAME', 'SIRET'] }])).toThrow(/valeur inconnue/);
    expect(() => parseCriteria([{ type: 'PROFILE_FIELD_REQUIRED', fields: ['NAME', 'NAME'] }])).toThrow(/double/);
    expect(() => parseCriteria([{ type: 'ACCOUNT_TYPE', roles: ['admin'] }])).toThrow(/valeur inconnue/);
  });

  it('refuses invalid numbers, empty lists, deep nesting and non-plain objects', () => {
    expect(() => parseCriteria([])).toThrow();
    expect(() => parseCriteria([{ type: 'MIN_PUBLIC_PORTFOLIO_IMAGES', min: 0 }])).toThrow();
    expect(() => parseCriteria([{ type: 'MIN_PUBLIC_PORTFOLIO_IMAGES', min: 2.5 }])).toThrow();
    expect(() => parseCriteria([{ type: 'CONTACT_REQUIRED', channels: ['PHONE'], min: 2 }])).toThrow();
    const leaf = { type: 'PUBLIC_PROFILE' };
    const deep = { type: 'ALL_OF', criteria: [leaf, { type: 'ANY_OF', criteria: [leaf, { type: 'ALL_OF', criteria: [leaf, leaf] }] }] };
    expect(() => parseCriteria([deep])).toThrow(/imbrication/);
    expect(() => parseCriteria([Object.create({ type: 'PUBLIC_PROFILE' })])).toThrow();
    expect(() => parseCriteria('[{"type":"PUBLIC_PROFILE"}]')).toThrow();
  });

  it('accepts simple combinations', () => {
    const parsed = parseCriteria([
      { type: 'ANY_OF', criteria: [{ type: 'MIN_PUBLIC_PORTFOLIO_IMAGES', min: 5 }, { type: 'MIN_PUBLIC_STUDIO_IMAGES', min: 5 }] },
    ]);
    expect(parsed[0].type).toBe('ANY_OF');
  });
});

describe('giveaway criteria — evaluation', () => {
  const [independent, salon] = inkera20262027Definition().categories.map((c) => parseCriteria(c.criteria));

  it('independent artist with a complete profile and 5 distinct works is eligible', () => {
    const r = evaluateCriteria(independent, fullFacts());
    expect(r).toMatchObject({ eligible: true, missingFields: [] });
  });

  it('incomplete profile lists exactly what is missing', () => {
    const r = evaluateCriteria(independent, fullFacts({
      fields: { ...fullFacts().fields, PROFILE_PHOTO: false, STYLE: false },
      contacts: { PHONE: false, INSTAGRAM: false, WEBSITE: false, FACEBOOK: false, TIKTOK: false },
      portfolioImages: 4,
    }));
    expect(r.eligible).toBe(false);
    expect(r.missingFields).toEqual(expect.arrayContaining(['PROFILE_PHOTO', 'STYLE', 'PORTFOLIO_IMAGES']));
    expect(r.missingFields.some((m) => m.startsWith('CONTACT:'))).toBe(true);
    const portfolio = r.criteria.find((c) => c.type === 'MIN_PUBLIC_PORTFOLIO_IMAGES')!;
    expect(portfolio).toMatchObject({ required: 5, actual: 4 });
  });

  it('a hidden profile counts as no public work and fails PUBLIC_PROFILE', () => {
    const r = evaluateCriteria(independent, fullFacts({ publicVisibility: 'HIDDEN' }));
    expect(r.missingFields).toEqual(expect.arrayContaining(['PUBLIC_PROFILE', 'PORTFOLIO_IMAGES']));
  });

  it('salon may combine gallery photos and works, and needs opening hours', () => {
    const facts = fullFacts({ role: 'user_salon', portfolioImages: 2, studioImages: 3, studioOrPortfolioImages: 5 });
    expect(evaluateCriteria(salon, facts).eligible).toBe(true);
    const noHours = fullFacts({ role: 'user_salon', studioOrPortfolioImages: 5, fields: { ...fullFacts().fields, HOURS: false } });
    expect(evaluateCriteria(salon, noHours).missingFields).toContain('HOURS');
  });

  it('unverified e-mail fails ACTIVE_ACCOUNT', () => {
    expect(evaluateCriteria(independent, fullFacts({ emailVerified: false })).missingFields).toContain('EMAIL_VERIFIED');
  });

  it('categories apply by account type; admin and client match nothing', () => {
    expect(categoryAppliesTo(independent, 'user_tatoueur')).toBe(true);
    expect(categoryAppliesTo(independent, 'user_salon')).toBe(false);
    expect(categoryAppliesTo(salon, 'user_salon')).toBe(true);
    for (const role of ['admin', 'client', 'formateur']) {
      expect(categoryAppliesTo(independent, role)).toBe(false);
      expect(categoryAppliesTo(salon, role)).toBe(false);
    }
  });
});
