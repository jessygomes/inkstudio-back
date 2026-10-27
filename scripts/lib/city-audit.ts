export type Commune = { nom: string; code: string; codesPostaux: string[] };
export type Location = { city: string | null; postalCode: string | null };

export function normalizeCity(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// Keep this aligned with UserService.buildLocationSlug: punctuation can change URLs.
export function locationSlug({ city, postalCode }: Location): string {
  return (
    [city, postalCode]
      .filter((value) => value?.trim())
      .join('-')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'localisation'
  );
}

export function createCityMatcher(communes: Commune[]) {
  const byName = new Map<string, Commune[]>();
  const byPostalCode = new Map<string, Commune[]>();
  for (const commune of communes) {
    const key = normalizeCity(commune.nom);
    byName.set(key, [...(byName.get(key) ?? []), commune]);
    for (const postalCode of commune.codesPostaux) {
      byPostalCode.set(postalCode, [
        ...(byPostalCode.get(postalCode) ?? []),
        commune,
      ]);
    }
  }

  return (before: Location) => {
    const name = normalizeCity(before.city ?? '');
    const postalCode = before.postalCode?.trim() ?? '';
    const nameMatches = name ? (byName.get(name) ?? []) : [];
    const matches = nameMatches.filter((commune) =>
      commune.codesPostaux.includes(postalCode),
    );
    const match = matches.length === 1 ? matches[0] : null;
    const after = match ? { city: match.nom, postalCode } : null;
    const candidates = match
      ? [match]
      : [
          ...new Map(
            [...nameMatches, ...(byPostalCode.get(postalCode) ?? [])].map(
              (commune) => [commune.code, commune],
            ),
          ).values(),
        ];
    const status =
      !before.city?.trim() && !postalCode
        ? 'missing'
        : !match
          ? 'review'
          : before.city === after?.city &&
              before.postalCode === after?.postalCode
            ? 'conform'
            : 'correctable';
    return {
      status,
      reason:
        status === 'missing'
          ? 'Localisation absente'
          : match
            ? 'Correspondance unique du nom normalisé et du code postal'
            : matches.length > 1
              ? 'Plusieurs communes correspondent au nom et au code postal'
              : 'Aucune correspondance certaine du nom et du code postal',
      before,
      after,
      communeCode: match?.code ?? null,
      oldLocationSlug: locationSlug(before),
      newLocationSlug: after ? locationSlug(after) : null,
      slugChanged: after ? locationSlug(before) !== locationSlug(after) : false,
      candidateCount: candidates.length,
      candidates: candidates.slice(0, 10),
    };
  };
}

export function validateCommunes(value: unknown): asserts value is Commune[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      'Le référentiel des communes doit être un tableau non vide.',
    );
  }
  const codes = new Set<string>();
  for (const candidate of value as unknown[]) {
    if (!candidate || typeof candidate !== 'object') {
      throw new Error('Commune invalide dans le référentiel.');
    }
    const item = candidate as Record<string, unknown>;
    if (
      !item ||
      typeof item.nom !== 'string' ||
      !normalizeCity(item.nom) ||
      typeof item.code !== 'string' ||
      !item.code ||
      codes.has(item.code) ||
      !Array.isArray(item.codesPostaux) ||
      !item.codesPostaux.every(
        (code: unknown) => typeof code === 'string' && /^\d{5}$/.test(code),
      )
    ) {
      throw new Error(
        'Commune invalide ou code INSEE dupliqué dans le référentiel.',
      );
    }
    codes.add(item.code);
  }
}
