import { createHmac } from 'node:crypto';
import {
  assertInstagramWebhookSignature, createInstagramState, decryptInstagramToken,
  encryptInstagramToken, verifyInstagramState,
} from './instagram-security';

describe('Instagram : secrets, OAuth et Webhooks', () => {
  const original = { ...process.env };
  beforeEach(() => {
    process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.INSTAGRAM_OAUTH_STATE_SECRET = 'etat-test-tres-long-pour-hmac';
    process.env.INSTAGRAM_APP_SECRET = 'cle-secrete-meta-de-test';
  });
  afterEach(() => { process.env = { ...original }; jest.restoreAllMocks(); });

  it('chiffre les tokens AES-GCM avec un IV aléatoire et refuse une altération', () => {
    const first = encryptInstagramToken('token-sensible');
    const second = encryptInstagramToken('token-sensible');
    expect(first).not.toEqual(second);
    expect(first).not.toContain('token-sensible');
    expect(decryptInstagramToken(first)).toBe('token-sensible');
    const parts = first.split(':');
    parts[3] = Buffer.from('altéré').toString('base64url');
    expect(() => decryptInstagramToken(parts.join(':'))).toThrow();
  });

  it('lie le retour OAuth au professionnel et rejette les états modifiés ou expirés', () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const state = createInstagramState('user-studio');
    expect(verifyInstagramState(state).userId).toBe('user-studio');
    const [payload, signature] = state.split('.');
    expect(() => verifyInstagramState(`${payload}A.${signature}`)).toThrow();
    jest.spyOn(Date, 'now').mockReturnValue(now + 11 * 60 * 1000);
    expect(() => verifyInstagramState(state)).toThrow('expiré');
  });

  it('accepte uniquement une signature SHA-256 calculée sur les octets originaux', () => {
    const raw = Buffer.from('{"object":"instagram","entry":[]}');
    const signature = `sha256=${createHmac('sha256', process.env.INSTAGRAM_APP_SECRET!).update(raw).digest('hex')}`;
    expect(() => assertInstagramWebhookSignature(raw, signature)).not.toThrow();
    expect(() => assertInstagramWebhookSignature(Buffer.from('{"entry":[],"object":"instagram"}'), signature)).toThrow();
    expect(() => assertInstagramWebhookSignature(undefined, signature)).toThrow();
    expect(() => assertInstagramWebhookSignature(raw, 'sha256=invalid')).toThrow();
  });
});
