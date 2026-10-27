import { searchGeographyWhere } from './search-geography';

function postalCodes(region?: string, department?: string): string[] {
  const filter = searchGeographyWhere(region, department);
  return (filter?.postalCode as { in: string[] })?.in || [];
}

describe('directory geography', () => {
  it('leaves results unchanged without a geographic selection', () => {
    expect(searchGeographyWhere()).toBeUndefined();
  });
  it('matches several departments', () => {
    expect(postalCodes(undefined, '75,69')).toEqual(expect.arrayContaining(['75001', '69001']));
    expect(postalCodes(undefined, '75,69')).not.toContain('13001');
  });
  it('matches departments inside a region', () => {
    expect(postalCodes('11')).toContain('75001');
    expect(postalCodes('11')).not.toContain('69001');
  });
  it('intersects selected regions and departments', () => {
    expect(postalCodes('11', '75')).toContain('75001');
    expect(postalCodes('84', '75')).toEqual([]);
  });
  it('supports several regions', () => {
    expect(postalCodes('11,84')).toEqual(expect.arrayContaining(['75001', '69001']));
  });
  it('distinguishes Corsican departments using official postal codes', () => {
    expect(postalCodes(undefined, '2A')).toContain('20000');
    expect(postalCodes(undefined, '2A')).not.toContain('20200');
    expect(postalCodes(undefined, '2B')).toContain('20200');
  });
  it('includes overseas departments and regions', () => {
    expect(postalCodes('04', '974')).toContain('97400');
    expect(postalCodes(undefined, '971')).toContain('97100');
  });
  it('returns no results for unknown codes', () => {
    expect(postalCodes('unknown')).toEqual([]);
    expect(postalCodes(undefined, 'unknown')).toEqual([]);
  });
});