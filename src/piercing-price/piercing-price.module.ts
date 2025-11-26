import { Module } from '@nestjs/common';

import { PrismaService } from 'src/database/prisma.service';
import { SaasModule } from 'src/saas/saas.module';
import { CacheService } from 'src/redis/cache.service';
import { PiercingPriceController } from './piercing-price.controller';
import { PiercingPriceService } from './piercing-price.service';

@Module({
  imports: [SaasModule],
  controllers: [PiercingPriceController],
  providers: [PiercingPriceService, PrismaService, CacheService],
})
export class PiercingPriceModule {}
