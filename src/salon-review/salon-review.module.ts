import { Module } from '@nestjs/common';
import { SalonReviewService } from './salon-review.service';
import { SalonReviewController } from './salon-review.controller';
import { CacheService } from 'src/redis/cache.service';
import { PrismaModule } from 'src/database/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [SalonReviewController],
  providers: [SalonReviewService, CacheService],
})
export class SalonReviewModule {}
