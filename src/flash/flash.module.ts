import { Module } from '@nestjs/common';
import { FlashController } from './flash.controller';
import { FlashService } from './flash.service';
import { PrismaService } from 'src/database/prisma.service';
import { CacheService } from 'src/redis/cache.service';

@Module({
  controllers: [FlashController],
  providers: [FlashService, PrismaService, CacheService],
  exports: [FlashService, PrismaService],
})
export class FlashModule {}
