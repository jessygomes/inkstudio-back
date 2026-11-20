import { createHmac, randomUUID, timingSafeEqual } from 'crypto';

/**
 * Identité de visiteur sans compte pour les envois d'images d'une réservation depuis l'app People, équivalente au cookie
 * signé du site People (`upload-guest-v2`) : identifiant aléatoire délivré par le serveur, valable 30 minutes, signé
 * (HMAC SHA-256) avec le secret du contrat « public ». L'app ne peut donc pas choisir ni fabriquer son identifiant :
 * le plafond d'envoi par visiteur s'applique comme sur le site.
 * Format : `<uuid>.<expiration en ms>.<signature hex>`.
 */
export const GUEST_UPLOAD_TOKEN_TTL_MS = 30 * 60_000;
const PREFIX = 'upload-guest-app-v1';

function secret(): string | null {
  const value = process.env.UPLOAD_OWNERSHIP_PUBLIC_SECRET;
  return value && Buffer.byteLength(value) >= 32 ? value : null;
}

const mac = (key: string, id: string, expiry: number) => createHmac('sha256', key).update(`${PREFIX}:${id}:${expiry}`).digest();

/** Nouveau jeton (null si le secret n'est pas configuré). */
export function issueGuestUploadToken(now = Date.now()): { guestToken: string; expiresAt: string } | null {
  const key = secret();
  if (!key) return null;
  const id = randomUUID();
  const expiry = now + GUEST_UPLOAD_TOKEN_TTL_MS;
  return { guestToken: `${id}.${expiry}.${mac(key, id, expiry).toString('hex')}`, expiresAt: new Date(expiry).toISOString() };
}

/** Identifiant du visiteur si le jeton est authentique et encore valable, sinon null. */
export function verifyGuestUploadToken(token: unknown, now = Date.now()): string | null {
  const key = secret();
  if (!key || typeof token !== 'string' || token.length > 200) return null;
  const [id, rawExpiry, signature] = token.split('.');
  if (!id || !/^[a-f0-9-]{36}$/.test(id) || !/^\d{13}$/.test(rawExpiry ?? '') || !/^[a-f0-9]{64}$/.test(signature ?? '')) return null;
  const expiry = Number(rawExpiry);
  // Expiré, ou d'une durée plus longue que celle délivrée (jeton fabriqué).
  if (expiry <= now || expiry > now + GUEST_UPLOAD_TOKEN_TTL_MS + 60_000) return null;
  const expected = mac(key, id, expiry);
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && timingSafeEqual(expected, given) ? id : null;
}
