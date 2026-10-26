import { Global, Module } from '@nestjs/common';
import { PrismaModule } from 'src/database/prisma.module';
import { CacheService } from 'src/redis/cache.service';
import { ResidenciesController } from './residencies.controller';
import { ResidenciesService } from './residencies.service';
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [ResidenciesController],
  providers: [ResidenciesService, CacheService],
  exports: [ResidenciesService],
})
export class ResidenciesModule {}
