import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { PrismaModule } from 'src/database/prisma.module';
import { CacheService } from 'src/redis/cache.service';
import { MailModule } from 'src/email/mail.module';
import { RedisModule } from 'src/redis/redis.module';
import { PublicContactRateLimiterService } from './public-contact-rate-limiter.service';
import { PublicContactThrottleGuard } from './public-contact-throttle.guard';

@Module({
  imports: [PrismaModule, MailModule, RedisModule], //! Importer le module PrismaModule dans le module UserModule pour pouvoir utiliser le service PrismaService dans le service UserService
  controllers: [UserController],
  providers: [
    UserService,
    CacheService,
    PublicContactRateLimiterService,
    PublicContactThrottleGuard,
  ],
})
export class UserModule {}
