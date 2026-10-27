import type { Prisma } from '@prisma/client';
import { francePostalGeography } from './france-postal-geography';

const parseCodes = (value?: string) => new Set(
  (value || '').split(',').map((code) => code.trim().toUpperCase()).filter(Boolean),
);

/** OR within each geographic level; AND between regions and departments. */
export function searchGeographyWhere(region?: string, department?: string): Prisma.UserWhereInput | undefined {
  const regions = parseCodes(region);
  const departments = parseCodes(department);
  if (!regions.size && !departments.size) return undefined;
  const postalCodes = new Set<string>();
  for (const entry of francePostalGeography) {
    if (regions.size && !regions.has(entry.regionCode)) continue;
    if (departments.size && !departments.has(entry.code)) continue;
    entry.postalCodes.forEach(code => postalCodes.add(code));
  }
  // An unknown or incompatible selection must return no profiles, never the whole directory.
  return { postalCode: { in: [...postalCodes] } };
}