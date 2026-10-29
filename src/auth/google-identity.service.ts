import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';

@Injectable()
export class GoogleIdentityService {
  private readonly client = new OAuth2Client();

  async verify(idToken: string) {
    if (typeof idToken !== 'string' || !idToken.trim()) {
      throw new UnauthorizedException('Jeton Google requis.');
    }

    const audience =
      process.env.GOOGLE_ID_TOKEN_AUDIENCE?.trim() ||
      process.env.GOOGLE_CLIENT_ID?.trim() ||
      process.env.AUTH_GOOGLE_ID?.trim();
    if (!audience) {
      throw new ServiceUnavailableException(
        'La connexion Google est temporairement indisponible.',
      );
    }

    try {
      // The official verifier checks Google's signature, issuer, audience and expiry.
      const ticket = await this.client.verifyIdToken({ idToken, audience });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email || payload.email_verified !== true) {
        throw new Error('Missing verified Google identity');
      }
      const email = payload.email.trim().toLowerCase();
      if (!email) throw new Error('Missing Google email');

      return {
        subject: payload.sub,
        email,
        firstName: payload.given_name || '',
        lastName: payload.family_name || '',
        image: payload.picture || null,
        // A verified third-party email alone cannot authorize linking a local account.
        isEmailAuthoritative:
          email.endsWith('@gmail.com') || Boolean(payload.hd),
      };
    } catch {
      // Do not disclose tokens, certificate errors or provider responses.
      throw new UnauthorizedException('Jeton Google invalide ou expiré.');
    }
  }
}
