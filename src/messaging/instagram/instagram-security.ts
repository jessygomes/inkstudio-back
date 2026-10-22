import { BadRequestException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function requiredInstagramEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new ServiceUnavailableException(`Intégration Instagram non configurée (${name})`);
  return value;
}

function tokenKey(): Buffer {
  const hex = requiredInstagramEnv('INSTAGRAM_TOKEN_ENCRYPTION_KEY');
  if (!/^[a-f\d]{64}$/i.test(hex)) {
    throw new ServiceUnavailableException('La clé de chiffrement Instagram doit contenir 64 caractères hexadécimaux');
  }
  return Buffer.from(hex, 'hex');
}

/** AES-256-GCM, IV aléatoire pour chaque jeton ; aucune donnée secrète envoyée au navigateur. */
export function encryptInstagramToken(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', tokenKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join(':');
}

export function decryptInstagramToken(value: string): string {
  const [version, iv, tag, payload, ...extra] = value.split(':');
  if (version !== 'v1' || !iv || !tag || !payload || extra.length) {
    throw new ServiceUnavailableException('Format du jeton Instagram invalide');
  }
  const decipher = createDecipheriv('aes-256-gcm', tokenKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(payload, 'base64url')), decipher.final()]).toString('utf8');
}

type InstagramState = { userId: string; issuedAt: number; nonce: string };

export function createInstagramState(userId: string): string {
  const payload: InstagramState = { userId, issuedAt: Date.now(), nonce: randomBytes(16).toString('hex') };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', requiredInstagramEnv('INSTAGRAM_OAUTH_STATE_SECRET')).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

export function verifyInstagramState(state: string): InstagramState {
  const [encoded, signature, ...extra] = state.split('.');
  if (!encoded || !signature || extra.length || encoded.length > 2048) throw new BadRequestException('État OAuth invalide');
  const expected = createHmac('sha256', requiredInstagramEnv('INSTAGRAM_OAUTH_STATE_SECRET')).update(encoded).digest();
  const supplied = Buffer.from(signature, 'base64url');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new BadRequestException('État OAuth non authentifié');
  }
  let parsed: InstagramState;
  try { parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); }
  catch { throw new BadRequestException('État OAuth illisible'); }
  if (!parsed?.userId || !parsed.nonce || !Number.isFinite(parsed.issuedAt) ||
      Date.now() - parsed.issuedAt > 10 * 60 * 1000 || parsed.issuedAt > Date.now() + 60_000) {
    throw new BadRequestException('État OAuth expiré');
  }
  return parsed;
}

/** Refuse également les requêtes sans corps brut ; ne jamais comparer le JSON re-sérialisé. */
export function assertInstagramWebhookSignature(rawBody: Buffer | undefined, signature: string | undefined): void {
  if (!rawBody || !signature?.startsWith('sha256=')) throw new UnauthorizedException('Signature Meta manquante');
  const expected = createHmac('sha256', requiredInstagramEnv('INSTAGRAM_APP_SECRET')).update(rawBody).digest();
  const actualHex = signature.slice(7);
  if (!/^[0-9a-f]{64}$/i.test(actualHex)) throw new UnauthorizedException('Signature Meta invalide');
  const actual = Buffer.from(actualHex, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new UnauthorizedException('Signature Meta invalide');
  }
}
