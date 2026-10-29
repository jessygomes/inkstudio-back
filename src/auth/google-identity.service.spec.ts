import { generateKeyPairSync, sign } from 'node:crypto';
import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { GoogleIdentityService } from './google-identity.service';

// Exercise the real Google JWT verifier with local keys; no Google/network dependency.
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const audience = 'inkera-test.apps.googleusercontent.com';

function token(
  overrides: Record<string, unknown> = {},
  invalidSignature = false,
) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: 'RS256', kid: 'test-key' }),
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: 'https://accounts.google.com',
      aud: audience,
      sub: 'google-user-123',
      iat: now - 30,
      exp: now + 3600,
      email: 'verified@gmail.com',
      email_verified: true,
      given_name: 'Google',
      family_name: 'User',
      picture: 'https://example.test/avatar.png',
      ...overrides,
    }),
  ).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), invalidSignature ? otherKeys.privateKey : keys.privateKey).toString('base64url')}`;
}

describe('GoogleIdentityService', () => {
  const originalClientId = process.env.GOOGLE_CLIENT_ID;
  const originalAuthId = process.env.AUTH_GOOGLE_ID;
  const originalAudience = process.env.GOOGLE_ID_TOKEN_AUDIENCE;
  let service: GoogleIdentityService;
  let certificates: jest.SpyInstance;

  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = audience;
    delete process.env.AUTH_GOOGLE_ID;
    delete process.env.GOOGLE_ID_TOKEN_AUDIENCE;
    certificates = jest
      .spyOn(OAuth2Client.prototype, 'getFederatedSignonCertsAsync')
      .mockResolvedValue({
        certs: {
          'test-key': keys.publicKey
            .export({ type: 'spki', format: 'pem' })
            .toString(),
        },
        format: 'PEM' as Awaited<
          ReturnType<OAuth2Client['getFederatedSignonCertsAsync']>
        >['format'],
      });
    service = new GoogleIdentityService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = originalClientId;
    if (originalAuthId === undefined) delete process.env.AUTH_GOOGLE_ID;
    else process.env.AUTH_GOOGLE_ID = originalAuthId;
    if (originalAudience === undefined)
      delete process.env.GOOGLE_ID_TOKEN_AUDIENCE;
    else process.env.GOOGLE_ID_TOKEN_AUDIENCE = originalAudience;
  });

  it('accepts a signed Google identity for the configured application', async () => {
    await expect(service.verify(token())).resolves.toEqual({
      subject: 'google-user-123',
      email: 'verified@gmail.com',
      firstName: 'Google',
      lastName: 'User',
      image: 'https://example.test/avatar.png',
      isEmailAuthoritative: true,
    });
  });

  it.each([
    ['another application', { aud: 'attacker.apps.googleusercontent.com' }],
    ['another issuer', { iss: 'https://attacker.example.test' }],
    ['expired identity', { exp: Math.floor(Date.now() / 1000) - 3600 }],
    ['future identity', { iat: Math.floor(Date.now() / 1000) + 3600 }],
    ['missing subject', { sub: '' }],
    ['missing email', { email: undefined }],
    ['unverified email', { email_verified: false }],
    ['non-boolean verification', { email_verified: 'true' }],
  ])('rejects %s', async (_name, claims) => {
    await expect(service.verify(token(claims))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a token signed by another key', async () => {
    await expect(service.verify(token({}, true))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it.each(['', '   ', 'not-a-jwt'])(
    'rejects missing or malformed token %p',
    async (value) => {
      await expect(service.verify(value)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    },
  );

  it('fails closed when no client ID is configured', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    await expect(service.verify(token())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(certificates).not.toHaveBeenCalled();
  });

  it('supports the frontend client ID environment alias', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    process.env.AUTH_GOOGLE_ID = audience;
    await expect(service.verify(token())).resolves.toMatchObject({
      subject: 'google-user-123',
    });
  });

  it('uses the explicitly configured frontend audience ahead of legacy OAuth credentials', async () => {
    process.env.GOOGLE_CLIENT_ID = 'legacy-backend.apps.googleusercontent.com';
    process.env.GOOGLE_ID_TOKEN_AUDIENCE = audience;
    await expect(service.verify(token())).resolves.toMatchObject({
      subject: 'google-user-123',
    });
    await expect(
      service.verify(token({ aud: process.env.GOOGLE_CLIENT_ID })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects provider errors without exposing the token or internal error', async () => {
    certificates.mockRejectedValue(
      new Error('internal certificate error with secret token'),
    );
    await expect(service.verify(token())).rejects.toThrow(
      'Jeton Google invalide ou expiré.',
    );
  });

  it('does not treat a verified third-party email as authoritative for account linking', async () => {
    await expect(
      service.verify(token({ email: 'owner@example.test' })),
    ).resolves.toMatchObject({ isEmailAuthoritative: false });
  });

  it('allows Google Workspace to establish email ownership', async () => {
    await expect(
      service.verify(
        token({ email: 'owner@example.test', hd: 'example.test' }),
      ),
    ).resolves.toMatchObject({ isEmailAuthoritative: true });
  });
});
