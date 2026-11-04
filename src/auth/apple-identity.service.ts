import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify,
  type JsonWebKey,
} from 'node:crypto';
import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_KEYS_URL = 'https://appleid.apple.com/auth/keys';
const KEYS_TTL_MS = 60 * 60 * 1000;
// Avoid hammering Apple when an attacker sends tokens with random key IDs.
const KEYS_REFRESH_COOLDOWN_MS = 60 * 1000;
const CLOCK_SKEW_SECONDS = 60;

type AppleJwk = JsonWebKey & { kid?: string; alg?: string; use?: string };

export interface AppleIdentity {
  subject: string;
  email: string | null;
  isEmailAuthoritative: boolean;
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// Apple serializes these claims either as booleans or as the strings "true"/"false".
function isTrue(value: unknown) {
  return value === true || value === 'true';
}

@Injectable()
export class AppleIdentityService {
  private keys: AppleJwk[] = [];
  private keysFetchedAt = 0;

  /**
   * Verifies an "Sign in with Apple" identity token (JWT, RS256) server-side:
   * signature (Apple JWKS), issuer, audience, expiry, and optional nonce.
   */
  async verify(identityToken: string, nonce?: string): Promise<AppleIdentity> {
    if (typeof identityToken !== 'string' || !identityToken.trim()) {
      throw new UnauthorizedException('Jeton Apple requis.');
    }

    // Native iOS uses the bundle ID, the web flow uses the Services ID: accept a list.
    const audiences = (process.env.APPLE_CLIENT_ID ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (!audiences.length) {
      throw new ServiceUnavailableException(
        'La connexion Apple est temporairement indisponible.',
      );
    }

    try {
      const parts = identityToken.trim().split('.');
      if (parts.length !== 3) throw new Error('Malformed token');
      const [rawHeader, rawPayload, rawSignature] = parts;
      const header = JSON.parse(Buffer.from(rawHeader, 'base64url').toString());
      const payload = JSON.parse(
        Buffer.from(rawPayload, 'base64url').toString(),
      );

      // Pin the algorithm: never trust the token to pick "none" or an HMAC.
      if (header?.alg !== 'RS256' || typeof header.kid !== 'string') {
        throw new Error('Unsupported algorithm');
      }

      const jwk = await this.findKey(header.kid);
      if (!jwk) throw new Error('Unknown signing key');
      const valid = verify(
        'RSA-SHA256',
        Buffer.from(`${rawHeader}.${rawPayload}`),
        createPublicKey({ key: jwk, format: 'jwk' }),
        Buffer.from(rawSignature, 'base64url'),
      );
      if (!valid) throw new Error('Invalid signature');

      const now = Math.floor(Date.now() / 1000);
      if (payload.iss !== APPLE_ISSUER) throw new Error('Bad issuer');
      if (typeof payload.aud !== 'string' || !audiences.includes(payload.aud)) {
        throw new Error('Bad audience');
      }
      if (typeof payload.exp !== 'number' || payload.exp <= now) {
        throw new Error('Expired');
      }
      if (typeof payload.iat !== 'number' || payload.iat > now + CLOCK_SKEW_SECONDS) {
        throw new Error('Issued in the future');
      }
      if (typeof payload.sub !== 'string' || !payload.sub) {
        throw new Error('Missing subject');
      }

      // Replay protection: the client hashes its raw nonce (SHA-256 hex) into the request.
      if (payload.nonce !== undefined || nonce) {
        if (typeof payload.nonce !== 'string' || !nonce) {
          throw new Error('Nonce mismatch');
        }
        const hashed = createHash('sha256').update(nonce).digest('hex');
        if (!safeEqual(payload.nonce, nonce) && !safeEqual(payload.nonce, hashed)) {
          throw new Error('Nonce mismatch');
        }
      }

      const email =
        typeof payload.email === 'string' && payload.email.trim()
          ? payload.email.trim().toLowerCase()
          : null;
      const isPrivateRelay =
        isTrue(payload.is_private_email) ||
        Boolean(email?.endsWith('@privaterelay.appleid.com'));

      return {
        subject: payload.sub,
        email,
        // A relay address never matches a pre-existing local account, so only a real,
        // Apple-verified address may be used to link an existing account.
        isEmailAuthoritative:
          Boolean(email) && isTrue(payload.email_verified) && !isPrivateRelay,
      };
    } catch {
      // Do not disclose tokens, key material or provider responses.
      throw new UnauthorizedException('Jeton Apple invalide ou expiré.');
    }
  }

  private async findKey(kid: string): Promise<AppleJwk | undefined> {
    const find = () => this.keys.find((key) => key.kid === kid);
    const fresh = Date.now() - this.keysFetchedAt < KEYS_TTL_MS;
    if (fresh && find()) return find();
    // Unknown kid: Apple may have rotated keys, refresh but respect the cooldown.
    if (
      !this.keys.length ||
      !fresh ||
      Date.now() - this.keysFetchedAt > KEYS_REFRESH_COOLDOWN_MS
    ) {
      await this.refreshKeys();
    }
    return find();
  }

  private async refreshKeys() {
    const response = await fetch(APPLE_KEYS_URL, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Apple keys unavailable');
    const body = (await response.json()) as { keys?: AppleJwk[] };
    if (!Array.isArray(body.keys) || !body.keys.length) {
      throw new Error('Apple keys malformed');
    }
    this.keys = body.keys.filter((key) => key.kty === 'RSA');
    this.keysFetchedAt = Date.now();
  }
}
