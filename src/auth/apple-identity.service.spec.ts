import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AppleIdentityService } from './apple-identity.service';

// Exercise the real verifier with local keys; Apple's JWKS endpoint is mocked.
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const audience = 'com.inkera.app';

function token(
  overrides: Record<string, unknown> = {},
  { invalidSignature = false, header = {} as Record<string, unknown> } = {},
) {
  const now = Math.floor(Date.now() / 1000);
  const encodedHeader = Buffer.from(
    JSON.stringify({ alg: 'RS256', kid: 'apple-key', ...header }),
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: 'https://appleid.apple.com',
      aud: audience,
      sub: '001234.apple.subject',
      iat: now - 30,
      exp: now + 3600,
      email: 'client@example.test',
      email_verified: 'true',
      is_private_email: 'false',
      ...overrides,
    }),
  ).toString('base64url');
  const input = `${encodedHeader}.${payload}`;
  const signature = sign(
    'RSA-SHA256',
    Buffer.from(input),
    invalidSignature ? otherKeys.privateKey : keys.privateKey,
  ).toString('base64url');
  return `${input}.${signature}`;
}

describe('AppleIdentityService', () => {
  const originalClientId = process.env.APPLE_CLIENT_ID;
  let service: AppleIdentityService;
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    process.env.APPLE_CLIENT_ID = audience;
    fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        keys: [
          {
            ...keys.publicKey.export({ format: 'jwk' }),
            kid: 'apple-key',
            alg: 'RS256',
            use: 'sig',
          },
        ],
      }),
    } as Response);
    service = new AppleIdentityService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalClientId === undefined) delete process.env.APPLE_CLIENT_ID;
    else process.env.APPLE_CLIENT_ID = originalClientId;
  });

  it('accepts a signed Apple identity for the configured application', async () => {
    await expect(service.verify(token())).resolves.toEqual({
      subject: '001234.apple.subject',
      email: 'client@example.test',
      isEmailAuthoritative: true,
    });
  });

  it('accepts any of several configured audiences (bundle ID + Services ID)', async () => {
    process.env.APPLE_CLIENT_ID = `com.other.web, ${audience}`;
    await expect(service.verify(token())).resolves.toMatchObject({
      subject: '001234.apple.subject',
    });
  });

  it.each([
    ['another application', { aud: 'com.attacker.app' }],
    ['another issuer', { iss: 'https://attacker.example.test' }],
    ['expired identity', { exp: Math.floor(Date.now() / 1000) - 3600 }],
    ['future identity', { iat: Math.floor(Date.now() / 1000) + 3600 }],
    ['missing subject', { sub: '' }],
  ])('rejects %s', async (_name, claims) => {
    await expect(service.verify(token(claims))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a token signed by another key', async () => {
    await expect(
      service.verify(token({}, { invalidSignature: true })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it.each([
    ['alg none', { alg: 'none' }],
    ['alg HS256', { alg: 'HS256' }],
    ['unknown kid', { kid: 'attacker-key' }],
  ])('rejects a header with %s', async (_name, header) => {
    await expect(
      service.verify(token({}, { header })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it.each(['', '   ', 'not-a-jwt', 'a.b.c'])(
    'rejects missing or malformed token %p',
    async (value) => {
      await expect(service.verify(value)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    },
  );

  it('fails closed when no client ID is configured', async () => {
    delete process.env.APPLE_CLIENT_ID;
    await expect(service.verify(token())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hides provider errors', async () => {
    fetchMock.mockRejectedValue(new Error('internal error with secret'));
    await expect(service.verify(token())).rejects.toThrow(
      'Jeton Apple invalide ou expiré.',
    );
  });

  it('caches the Apple keys between verifications', async () => {
    await service.verify(token());
    await service.verify(token());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not refetch keys on every unknown key ID (cooldown)', async () => {
    await expect(
      service.verify(token({}, { header: { kid: 'x1' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      service.verify(token({}, { header: { kid: 'x2' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  describe('nonce', () => {
    it('accepts a raw or SHA-256 hashed nonce matching the client nonce', async () => {
      const hashed = createHash('sha256').update('raw-nonce').digest('hex');
      await expect(
        service.verify(token({ nonce: hashed }), 'raw-nonce'),
      ).resolves.toBeDefined();
      await expect(
        service.verify(token({ nonce: 'raw-nonce' }), 'raw-nonce'),
      ).resolves.toBeDefined();
    });

    it('rejects a different nonce', async () => {
      await expect(
        service.verify(token({ nonce: 'other' }), 'raw-nonce'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a token carrying a nonce when the client supplies none', async () => {
      await expect(
        service.verify(token({ nonce: 'abc' })),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a client nonce that the token does not carry', async () => {
      await expect(
        service.verify(token(), 'raw-nonce'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('email handling', () => {
    it('accepts boolean claims as well as Apple string claims', async () => {
      await expect(
        service.verify(
          token({ email_verified: true, is_private_email: false }),
        ),
      ).resolves.toMatchObject({ isEmailAuthoritative: true });
    });

    it('does not treat an unverified email as authoritative', async () => {
      await expect(
        service.verify(token({ email_verified: 'false' })),
      ).resolves.toMatchObject({ isEmailAuthoritative: false });
    });

    it('does not treat a private relay address as authoritative', async () => {
      await expect(
        service.verify(
          token({
            email: 'abc123@privaterelay.appleid.com',
            is_private_email: 'true',
          }),
        ),
      ).resolves.toMatchObject({
        email: 'abc123@privaterelay.appleid.com',
        isEmailAuthoritative: false,
      });
    });

    it('returns a null email when Apple omits it', async () => {
      await expect(
        service.verify(token({ email: undefined })),
      ).resolves.toMatchObject({ email: null, isEmailAuthoritative: false });
    });
  });
});
