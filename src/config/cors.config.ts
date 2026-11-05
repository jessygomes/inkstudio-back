type CorsOriginCallback = (err: Error | null, allow?: boolean) => void;

const ENV_ORIGINS = [
  process.env.FRONT_URL,
  process.env.FRONTEND_URL,
  process.env.FRONTEND_URL_BIS,
  process.env.WEB_URL,
  // Domaines de production connus — couvre www et non-www via withHostVariants
  'https://inkera-studio.fr',
  'https://www.inkera-studio.fr',
  'https://inkera-studio.com',
  'https://www.inkera-studio.com',
  'https://theinkera.fr',
  'https://www.theinkera.fr',
  'https://theinkera.com',
  'https://www.theinkera.com',
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

// Origine du backend lui-même. React Native l'envoie comme en-tête `Origin` à l'ouverture d'un websocket (http[s]://hôte du
// serveur) et engine.io applique ce contrôle CORS aussi à l'upgrade websocket : sans elle, la messagerie mobile ne peut pas
// utiliser le websocket (elle retombe sur le polling). Seule une page servie par le backend lui-même émet cette origine :
// ce n'est pas une ouverture à d'autres sites. En local (téléphone sur le Wi-Fi), renseigner BACKEND_URL (ex. http://192.168.1.52:4000).
const BACKEND_PRODUCTION_ORIGIN = 'https://inkstudio-back-production.up.railway.app';

function originOf(value?: string): string | null {
  if (!value || !value.trim()) return null;
  try {
    const trimmed = value.trim();
    return new URL(/^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`).origin;
  } catch {
    return null;
  }
}

function buildBackendOrigins(): string[] {
  return [
    BACKEND_PRODUCTION_ORIGIN,
    originOf(process.env.BACKEND_URL),
    originOf(process.env.RAILWAY_PUBLIC_DOMAIN),
  ].filter((origin): origin is string => Boolean(origin));
}

export const ALLOWED_ORIGINS = Array.from(
  new Set([...buildAllowedOrigins(), ...buildBackendOrigins()]),
);

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
