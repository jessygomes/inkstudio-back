import { Module } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { SaasModule } from 'src/saas/saas.module';
import { CacheService } from 'src/redis/cache.service';
import { StocksController } from './stocks.controller';
import { StocksService } from './stocks.service';

@Module({
  imports: [SaasModule],
  controllers: [StocksController],
  providers: [StocksService, PrismaService, CacheService],
})
export class StocksModule {}
