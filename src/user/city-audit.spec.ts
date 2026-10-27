import {
  createCityMatcher,
  locationSlug,
  validateCommunes,
} from '../../scripts/lib/city-audit';

const communes = [
  { nom: 'Saint-Étienne', code: '42218', codesPostaux: ['42000', '42100'] },
  { nom: 'Sainte-Croix', code: '01001', codesPostaux: ['01120'] },
  { nom: 'Sainte-Croix', code: '02001', codesPostaux: ['02820'] },
  { nom: 'Autre commune', code: '01002', codesPostaux: ['01120'] },
];

describe('city audit', () => {
  const match = createCityMatcher(communes);

  it('recognizes an already canonical name and its second postal code', () => {
    expect(match({ city: 'Saint-Étienne', postalCode: '42100' }).status).toBe(
      'conform',
    );
  });

  it('canonicalizes accents, case and separators only when the postal code agrees', () => {
    const result = match({ city: ' SAINT ETIENNE ', postalCode: ' 42000 ' });
    expect(result.status).toBe('correctable');
    expect(result.after).toEqual({
      city: 'Saint-Étienne',
      postalCode: '42000',
    });
    expect(result.before.city).toBe(' SAINT ETIENNE ');
  });

  it('uses the postal code to disambiguate homonyms', () => {
    expect(
      match({ city: 'sainte croix', postalCode: '02820' }).communeCode,
    ).toBe('02001');
  });

  it.each([
    { city: 'Sainte-Croix', postalCode: null },
    { city: null, postalCode: '01120' },
    { city: 'Saint-Étienne', postalCode: '01120' },
    { city: 'St Etienne', postalCode: '42000' },
    { city: 'Saint-Étienne', postalCode: '4200' },
    { city: 'Une ville inconnue', postalCode: '99999' },
  ])('leaves uncertain data for review: %j', (before) => {
    expect(match(before)).toMatchObject({ status: 'review', after: null });
  });

  it('does not guess when normalization causes a collision', () => {
    const collision = createCityMatcher([
      ...communes,
      { nom: 'Saint Etienne', code: '99999', codesPostaux: ['42000'] },
    ]);
    expect(
      collision({ city: 'SAINT ETIENNE', postalCode: '42000' }).status,
    ).toBe('review');
  });

  it('reports missing locations separately', () => {
    expect(match({ city: ' ', postalCode: null }).status).toBe('missing');
  });

  it('flags URL changes instead of assuming all normalization preserves slugs', () => {
    expect(
      match({ city: 'SaintEtienne', postalCode: '42000' }).slugChanged,
    ).toBe(true);
    expect(
      match({ city: 'saint etienne', postalCode: '42000' }).slugChanged,
    ).toBe(false);
    expect(locationSlug({ city: null, postalCode: null })).toBe('localisation');
  });

  it('validates the reference before auditing any account', () => {
    expect(() => validateCommunes(communes)).not.toThrow();
    expect(() => validateCommunes([])).toThrow();
    expect(() => validateCommunes([...communes, communes[0]])).toThrow();
    expect(() =>
      validateCommunes([
        { nom: 'Paris', code: '75056', codesPostaux: [75000] },
      ]),
    ).toThrow();
  });
});
