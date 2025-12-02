import { Inject, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import googleOauthConfig from './google-oauth.config';
import { ConfigType } from '@nestjs/config';
import { AuthService } from './auth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    @Inject(googleOauthConfig.KEY) private readonly googleConfig: ConfigType<typeof googleOauthConfig>,
    private readonly authService: AuthService,
  ) {
    const { clientID, clientSecret, callbackURL } = googleConfig;
    
    if (!clientID || !clientSecret) {
      throw new Error('Google OAuth configuration is missing clientID or clientSecret');
    }

    super({
      clientID,
      clientSecret,
      callbackURL,
      scope: ['email', 'profile'],
    });
  }

  async validate(access_token: string, refresh_token: string, profile: any, done: VerifyCallback) {
    console.log('Google profile:', profile);

    // const user = await this.authService.validateGoogleUser({
    //   email: profile.emails[0].value,
    //   firstName: profile.name.givenName,
    //   lastName: profile.name.familyName,
    //   avatarUrl: profile.photos[0].value,
    //   password: "", // No password for OAuth users
    // });

    // done(null, user);
  }
}
