type CorsOriginCallback = (err: Error | null, allow?: boolean) => void;

const ENV_ORIGINS = [
  process.env.FRONT_URL,
  process.env.FRONTEND_URL,
  process.env.FRONTEND_URL_BIS,
  process.env.WEB_URL,
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
];

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function extractOriginHost(origin: string): string | null {
  try {
    return new URL(origin).hostname;
  } catch {
    return null;
  }
}

function withHostVariants(origin: string): string[] {
  const normalized = normalizeOrigin(origin);
  const host = extractOriginHost(normalized);
  if (!host) return [normalized];

  // Autorise automatiquement le couple www/non-www pour éviter les rejets en prod.
  const variants = [normalized];
  if (host.startsWith('www.')) {
    variants.push(normalized.replace('://www.', '://'));
  } else {
    variants.push(normalized.replace('://', '://www.'));
  }

  return variants;
}

function buildAllowedOrigins(): string[] {
  const expanded = ENV_ORIGINS.filter((value): value is string =>
    Boolean(value && value.trim()),
  )
    .flatMap(withHostVariants)
    .map(normalizeOrigin);

  return Array.from(new Set(expanded));
}

export const ALLOWED_ORIGINS = buildAllowedOrigins();

export function isAllowedOrigin(origin?: string): boolean {
  if (!origin) {
    // Requêtes serveur-à-serveur et checks sans Origin.
    return true;
  }

  const normalized = normalizeOrigin(origin);
  return ALLOWED_ORIGINS.includes(normalized);
}

export function corsOriginDelegate(
  origin: string | undefined,
  callback: CorsOriginCallback,
): void {
  if (isAllowedOrigin(origin)) {
    callback(null, true);
    return;
  }

  callback(new Error(`Origin not allowed: ${origin || 'unknown'}`));
}
