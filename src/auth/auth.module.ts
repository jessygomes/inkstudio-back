import { SecurityThrottleModule } from './security-throttle';
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PrismaService } from 'src/database/prisma.service';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './jwt.strategy';
import { UserService } from 'src/user/user.service';
import { MailModule } from 'src/email/mail.module';
import { SaasModule } from 'src/saas/saas.module';
import { CacheService } from 'src/redis/cache.service';
import { RedisModule } from 'src/redis/redis.module';
import { StripeModule } from 'src/stripe/stripe.module';
import { RegistrationRateLimiterService } from './registration-rate-limiter.service';
import { RegistrationThrottleGuard } from './registration-throttle.guard';
import { GoogleIdentityService } from './google-identity.service';
import { AppleIdentityService } from './apple-identity.service';
import { RefreshTokenService } from './refresh-token.service';
import { ClientInvitationsModule } from '../client-invitations/client-invitations.module';
// import googleOauthConfig from './google-oauth.config';
// import { ConfigModule } from '@nestjs/config';
// import { GoogleStrategy } from './google.strategy';

@Module({
  imports: [
    SecurityThrottleModule,
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET,
      // Durée du jeton d'accès. 7 jours tant que toutes les applications ne renouvellent pas leur jeton ; puis une durée courte (ex. 30m) via JWT_ACCESS_EXPIRES_IN.
      signOptions: { expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN ?? '7d') as `${number}${'s' | 'm' | 'h' | 'd'}` },
    }),
    SaasModule,
    MailModule,
    ClientInvitationsModule,
    StripeModule,
    // RedisModule exporte RedisService utilisé par RegistrationRateLimiterService.
    RedisModule,
    // ConfigModule.forFeature(googleOauthConfig),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    GoogleIdentityService,
    AppleIdentityService,
    RefreshTokenService,
    PrismaService,
    UserService,
    JwtStrategy,
    // GoogleStrategy,
    CacheService,
    RegistrationRateLimiterService,
    RegistrationThrottleGuard,
  ],
})
export class AuthModule {}
