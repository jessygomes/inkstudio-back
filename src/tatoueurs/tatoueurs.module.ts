import { Module } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { TatoueursController } from './tatoueurs.controller';
import { TatoueursService } from './tatoueurs.service';
import { SaasModule } from 'src/saas/saas.module';
import { CacheService } from 'src/redis/cache.service';

@Module({
  imports: [SaasModule],
  controllers: [TatoueursController],
  providers: [TatoueursService, PrismaService, CacheService],
})
export class TatoueursModule {}
