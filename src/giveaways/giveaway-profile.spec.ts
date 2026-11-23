import { EligibilityUser, hasOpeningHours, identitySignals, normalizePhone, profileFacts } from './giveaway-profile';

export const makeUser = (over: Partial<EligibilityUser> = {}): EligibilityUser => ({
  id: 'u1',
  role: 'user_tatoueur',
  email: 'artist@test.dev',
  emailVerified: new Date('2025-01-01'),
  publicVisibility: 'VISIBLE',
  salonName: 'Encre Noire',
  firstName: 'Ana',
  lastName: 'Lopez',
  profileImage: 'https://utfs.io/f/p.jpg',
  image: null,
  city: 'Lyon',
  address: '3 rue des Arts',
  postalCode: '69001',
  description: 'Tatouage fine line et botanique depuis 2015.',
  style: ['Fine line'],
  prestations: ['TATTOO'],
  salonHours: JSON.stringify({ monday: { start: '10:00', end: '18:00' }, tuesday: null }),
  salonPhotos: [],
  phone: '06 12 34 56 78',
  instagram: null,
  website: null,
  facebook: null,
  tiktok: null,
  ...over,
});

describe('giveaway profile mapping', () => {
  it('maps real User fields to criteria facts', () => {
    const facts = profileFacts(makeUser(), ['a', 'b', 'b', 'c', ' ', 'd', 'e']);
    expect(facts.fields).toMatchObject({ NAME: true, PROFILE_PHOTO: true, COVER_PHOTO: false, CITY: true, DESCRIPTION: true, STYLE: true, HOURS: true });
    expect(facts.contacts.PHONE).toBe(true);
    expect(facts.portfolioImages).toBe(5); // doublons et URL vides ignorés : réalisations distinctes
    expect(facts.publicRouteReady).toBe(true);
  });

  it('counts distinct gallery photos and the union with works', () => {
    const facts = profileFacts(makeUser({ salonPhotos: ['s1', 's2', 'a'] }), ['a', 'b']);
    expect(facts.studioImages).toBe(3);
    expect(facts.studioOrPortfolioImages).toBe(4);
  });

  it('short description, empty styles and invalid hours are missing', () => {
    const facts = profileFacts(makeUser({ description: 'Court', style: [' '], salonHours: '{"monday":{"start":"25:00","end":"18:00"}}' }), []);
    expect(facts.fields).toMatchObject({ DESCRIPTION: false, STYLE: false, HOURS: false });
    expect(hasOpeningHours('not json')).toBe(false);
    expect(hasOpeningHours(null)).toBe(false);
  });

  it('normalizes French phone numbers', () => {
    expect(normalizePhone('06 12 34 56 78')).toBe('612345678');
    expect(normalizePhone('+33 6 12 34 56 78')).toBe('612345678');
    expect(normalizePhone('0033612345678')).toBe('612345678');
    expect(normalizePhone('12')).toBeNull();
  });

  it('two accounts with the same phone or Instagram share a signal; unrelated accounts do not', () => {
    const a = identitySignals(makeUser({ phone: '0612345678', instagram: '@Encre.Noire' }));
    const b = identitySignals(makeUser({ phone: '+33 6 12 34 56 78', instagram: null, salonName: 'Autre', postalCode: '75001' }));
    const c = identitySignals(makeUser({ phone: '0700000000', instagram: 'https://instagram.com/encre.noire/', salonName: 'X', postalCode: null }));
    const d = identitySignals(makeUser({ phone: '0711111111', instagram: 'someone', salonName: 'Y', postalCode: null, website: 'https://instagram.com/x' }));
    expect(a.some((s) => b.includes(s))).toBe(true);
    expect(a.some((s) => c.includes(s))).toBe(true);
    expect(a.some((s) => d.includes(s))).toBe(false);
    // Aucune donnée en clair dans les signaux.
    expect(a.join()).not.toMatch(/612345678|encre/);
  });
});
