import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { redisStore } from 'cache-manager-redis-store';
import { CacheService } from './cache.service';
import { RedisService } from './redis.service';
import { RedisOnlineStatusService } from './redis-online-status.service';
import { RedisRateLimiterService } from './redis-rate-limiter.service';

@Module({
  imports: [
    CacheModule.registerAsync({
      isGlobal: true, // dispo partout dans ton app
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => ({
        store: await redisStore({
          socket: {
            host: config.get<string>('REDIS_HOST'),
            port: config.get<number>('REDIS_PORT'),
          },
          password: config.get<string>('REDIS_PASSWORD'),
          ttl: 300, // 5 minutes par défaut
        }),
      }),
    }),
  ],
  providers: [
    CacheService,
    RedisService,
    RedisOnlineStatusService,
    RedisRateLimiterService,
  ],
  exports: [
    CacheService,
    RedisService,
    RedisOnlineStatusService,
    RedisRateLimiterService,
  ],
})
export class RedisModule {}
