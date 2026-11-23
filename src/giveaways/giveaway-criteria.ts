/**
 * Règles d'éligibilité des concours : un petit langage déclaratif, validé par
 * liste blanche. Aucun code n'est exécuté depuis les données : chaque type de
 * critère correspond à une fonction écrite ici. Un type ou une clé inconnus
 * sont refusés (jamais ignorés).
 */

export const PROFILE_FIELDS = [
  'NAME',
  'PROFILE_PHOTO',
  'COVER_PHOTO',
  'CITY',
  'ADDRESS',
  'POSTAL_CODE',
  'DESCRIPTION',
  'STYLE',
  'HOURS',
  'PRESTATIONS',
] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

export const CONTACT_CHANNELS = [
  'PHONE',
  'INSTAGRAM',
  'WEBSITE',
  'FACEBOOK',
  'TIKTOK',
] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

/** Rôles professionnels pouvant participer (le rôle legacy `user` est accepté par les critères, pas forcé). */
export const PARTICIPANT_ROLES = ['user_salon', 'user_tatoueur', 'user'] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

export const CRITERION_TYPES = [
  'ACCOUNT_TYPE',
  'ACTIVE_ACCOUNT',
  'PUBLIC_PROFILE',
  'PROFILE_FIELD_REQUIRED',
  'CONTACT_REQUIRED',
  'MIN_PUBLIC_PORTFOLIO_IMAGES',
  'MIN_PUBLIC_STUDIO_IMAGES',
  'ALL_OF',
  'ANY_OF',
] as const;
export type CriterionType = (typeof CRITERION_TYPES)[number];

export type Criterion =
  | { type: 'ACCOUNT_TYPE'; roles: ParticipantRole[] }
  | { type: 'ACTIVE_ACCOUNT'; requireVerifiedEmail?: boolean }
  | { type: 'PUBLIC_PROFILE'; allowSearchHidden?: boolean }
  | { type: 'PROFILE_FIELD_REQUIRED'; fields: ProfileField[] }
  | { type: 'CONTACT_REQUIRED'; channels?: ContactChannel[]; min?: number }
  | { type: 'MIN_PUBLIC_PORTFOLIO_IMAGES'; min: number }
  | { type: 'MIN_PUBLIC_STUDIO_IMAGES'; min: number; includePortfolio?: boolean }
  | { type: 'ALL_OF'; criteria: Criterion[] }
  | { type: 'ANY_OF'; criteria: Criterion[] };

export class CriteriaValidationError extends Error {
  constructor(
    public readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
  }
}

const MAX_DEPTH = 3;
const MAX_NODES = 40;
const MAX_IMAGES = 500;

const allowedKeys: Record<CriterionType, string[]> = {
  ACCOUNT_TYPE: ['type', 'roles'],
  ACTIVE_ACCOUNT: ['type', 'requireVerifiedEmail'],
  PUBLIC_PROFILE: ['type', 'allowSearchHidden'],
  PROFILE_FIELD_REQUIRED: ['type', 'fields'],
  CONTACT_REQUIRED: ['type', 'channels', 'min'],
  MIN_PUBLIC_PORTFOLIO_IMAGES: ['type', 'min'],
  MIN_PUBLIC_STUDIO_IMAGES: ['type', 'min', 'includePortfolio'],
  ALL_OF: ['type', 'criteria'],
  ANY_OF: ['type', 'criteria'],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function enumList<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  { optional = false } = {},
): T[] | undefined {
  if (value === undefined && optional) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > allowed.length)
    throw new CriteriaValidationError(path, `liste non vide attendue (${allowed.join(', ')})`);
  const out: T[] = [];
  for (const [i, item] of value.entries()) {
    if (typeof item !== 'string' || !allowed.includes(item as T))
      throw new CriteriaValidationError(`${path}[${i}]`, `valeur inconnue (${allowed.join(', ')})`);
    if (out.includes(item as T))
      throw new CriteriaValidationError(`${path}[${i}]`, 'valeur en double');
    out.push(item as T);
  }
  return out;
}

function intIn(value: unknown, min: number, max: number, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    throw new CriteriaValidationError(path, `entier entre ${min} et ${max} attendu`);
  return value;
}

function optionalBool(value: unknown, path: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new CriteriaValidationError(path, 'booléen attendu');
  return value;
}

/** Valide et normalise une liste de critères. Lève CriteriaValidationError à la première erreur. */
export function parseCriteria(value: unknown, path = 'criteria'): Criterion[] {
  const counter = { nodes: 0 };
  if (!Array.isArray(value) || value.length === 0)
    throw new CriteriaValidationError(path, 'liste de critères non vide attendue');
  return value.map((item, i) => parseNode(item, `${path}[${i}]`, 1, counter));
}

function parseNode(
  value: unknown,
  path: string,
  depth: number,
  counter: { nodes: number },
): Criterion {
  if (++counter.nodes > MAX_NODES)
    throw new CriteriaValidationError(path, `au plus ${MAX_NODES} critères`);
  if (!isPlainObject(value)) throw new CriteriaValidationError(path, 'objet attendu');
  const type = value.type;
  if (typeof type !== 'string' || !(CRITERION_TYPES as readonly string[]).includes(type))
    throw new CriteriaValidationError(`${path}.type`, `type de critère inconnu (${String(type)})`);
  const t = type as CriterionType;
  for (const key of Object.keys(value))
    if (!allowedKeys[t].includes(key))
      throw new CriteriaValidationError(`${path}.${key}`, 'clé non autorisée');

  switch (t) {
    case 'ACCOUNT_TYPE':
      return { type: t, roles: enumList(value.roles, PARTICIPANT_ROLES, `${path}.roles`)! };
    case 'ACTIVE_ACCOUNT': {
      const requireVerifiedEmail = optionalBool(value.requireVerifiedEmail, `${path}.requireVerifiedEmail`);
      return { type: t, ...(requireVerifiedEmail !== undefined ? { requireVerifiedEmail } : {}) };
    }
    case 'PUBLIC_PROFILE': {
      const allowSearchHidden = optionalBool(value.allowSearchHidden, `${path}.allowSearchHidden`);
      return { type: t, ...(allowSearchHidden !== undefined ? { allowSearchHidden } : {}) };
    }
    case 'PROFILE_FIELD_REQUIRED':
      return { type: t, fields: enumList(value.fields, PROFILE_FIELDS, `${path}.fields`)! };
    case 'CONTACT_REQUIRED': {
      const channels = enumList(value.channels, CONTACT_CHANNELS, `${path}.channels`, { optional: true });
      const min =
        value.min === undefined
          ? undefined
          : intIn(value.min, 1, (channels ?? CONTACT_CHANNELS).length, `${path}.min`);
      return {
        type: t,
        ...(channels ? { channels } : {}),
        ...(min !== undefined ? { min } : {}),
      };
    }
    case 'MIN_PUBLIC_PORTFOLIO_IMAGES':
      return { type: t, min: intIn(value.min, 1, MAX_IMAGES, `${path}.min`) };
    case 'MIN_PUBLIC_STUDIO_IMAGES': {
      const includePortfolio = optionalBool(value.includePortfolio, `${path}.includePortfolio`);
      return {
        type: t,
        min: intIn(value.min, 1, MAX_IMAGES, `${path}.min`),
        ...(includePortfolio !== undefined ? { includePortfolio } : {}),
      };
    }
    case 'ALL_OF':
    case 'ANY_OF': {
      if (depth >= MAX_DEPTH)
        throw new CriteriaValidationError(path, `imbrication limitée à ${MAX_DEPTH} niveaux`);
      if (!Array.isArray(value.criteria) || value.criteria.length < 2 || value.criteria.length > 10)
        throw new CriteriaValidationError(`${path}.criteria`, 'entre 2 et 10 critères attendus');
      return {
        type: t,
        criteria: value.criteria.map((child, i) =>
          parseNode(child, `${path}.criteria[${i}]`, depth + 1, counter),
        ),
      };
    }
  }
}

/** Faits du profil, calculés à partir des vraies données (voir giveaway-eligibility.service.ts). */
export type ProfileFacts = {
  role: string;
  emailVerified: boolean;
  publicVisibility: 'VISIBLE' | 'SEARCH_HIDDEN' | 'HIDDEN';
  /** salonName, ville et code postal : sans eux, la page publique n'existe pas. */
  publicRouteReady: boolean;
  fields: Record<ProfileField, boolean>;
  contacts: Record<ContactChannel, boolean>;
  /** Réalisations distinctes (URL d'image distinctes) du portfolio. */
  portfolioImages: number;
  /** Photos distinctes de la galerie du salon. */
  studioImages: number;
  /** Union distincte galerie + portfolio. */
  studioOrPortfolioImages: number;
};

export type CriterionResult = {
  type: CriterionType;
  passed: boolean;
  missingFields?: string[];
  required?: number;
  actual?: number;
  children?: CriterionResult[];
};

function profileIsPublic(facts: ProfileFacts, allowSearchHidden = false) {
  const visible =
    facts.publicVisibility === 'VISIBLE' ||
    (allowSearchHidden && facts.publicVisibility === 'SEARCH_HIDDEN');
  return visible && facts.publicRouteReady;
}

export function evaluateCriterion(c: Criterion, facts: ProfileFacts): CriterionResult {
  switch (c.type) {
    case 'ACCOUNT_TYPE':
      return { type: c.type, passed: c.roles.includes(facts.role as ParticipantRole), ...(c.roles.includes(facts.role as ParticipantRole) ? {} : { missingFields: ['ACCOUNT_TYPE'] }) };
    case 'ACTIVE_ACCOUNT': {
      const passed = c.requireVerifiedEmail === false ? true : facts.emailVerified;
      return { type: c.type, passed, ...(passed ? {} : { missingFields: ['EMAIL_VERIFIED'] }) };
    }
    case 'PUBLIC_PROFILE': {
      const passed = profileIsPublic(facts, c.allowSearchHidden);
      return { type: c.type, passed, ...(passed ? {} : { missingFields: ['PUBLIC_PROFILE'] }) };
    }
    case 'PROFILE_FIELD_REQUIRED': {
      const missing = c.fields.filter((f) => !facts.fields[f]);
      return { type: c.type, passed: missing.length === 0, ...(missing.length ? { missingFields: missing } : {}) };
    }
    case 'CONTACT_REQUIRED': {
      const channels = c.channels ?? [...CONTACT_CHANNELS];
      const required = c.min ?? 1;
      const actual = channels.filter((ch) => facts.contacts[ch]).length;
      const passed = actual >= required;
      return {
        type: c.type,
        passed,
        required,
        actual,
        ...(passed ? {} : { missingFields: [`CONTACT:${channels.join('|')}`] }),
      };
    }
    case 'MIN_PUBLIC_PORTFOLIO_IMAGES': {
      // Le portfolio n'a pas de visibilité propre : il est public si le profil l'est.
      const actual = profileIsPublic(facts, true) ? facts.portfolioImages : 0;
      const passed = actual >= c.min;
      return { type: c.type, passed, required: c.min, actual, ...(passed ? {} : { missingFields: ['PORTFOLIO_IMAGES'] }) };
    }
    case 'MIN_PUBLIC_STUDIO_IMAGES': {
      const count = c.includePortfolio ? facts.studioOrPortfolioImages : facts.studioImages;
      const actual = profileIsPublic(facts, true) ? count : 0;
      const passed = actual >= c.min;
      return { type: c.type, passed, required: c.min, actual, ...(passed ? {} : { missingFields: [c.includePortfolio ? 'STUDIO_OR_PORTFOLIO_IMAGES' : 'STUDIO_IMAGES'] }) };
    }
    case 'ALL_OF':
    case 'ANY_OF': {
      const children = c.criteria.map((child) => evaluateCriterion(child, facts));
      const passed = c.type === 'ALL_OF' ? children.every((r) => r.passed) : children.some((r) => r.passed);
      const missing = passed ? [] : [...new Set(children.flatMap((r) => r.missingFields ?? []))];
      return { type: c.type, passed, children, ...(missing.length ? { missingFields: missing } : {}) };
    }
  }
}

export function evaluateCriteria(criteria: Criterion[], facts: ProfileFacts) {
  const results = criteria.map((c) => evaluateCriterion(c, facts));
  const missingFields = [...new Set(results.flatMap((r) => (r.passed ? [] : r.missingFields ?? [])))];
  return { eligible: results.every((r) => r.passed), criteria: results, missingFields };
}

/** Une catégorie s'adresse à un compte si tous ses critères ACCOUNT_TYPE de premier niveau l'acceptent. */
export function categoryAppliesTo(criteria: Criterion[], role: string): boolean {
  return criteria
    .filter((c): c is Extract<Criterion, { type: 'ACCOUNT_TYPE' }> => c.type === 'ACCOUNT_TYPE')
    .every((c) => c.roles.includes(role as ParticipantRole));
}
