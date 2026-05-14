import { Module } from '@nestjs/common';
import { SalonAnalyticsService } from './salon-analytics.service';
import { SalonAnalyticsController } from './salon-analytics.controller';
import { PrismaService } from 'src/database/prisma.service';

@Module({
  providers: [SalonAnalyticsService, PrismaService],
  controllers: [SalonAnalyticsController],
  exports: [SalonAnalyticsService],
})
export class SalonAnalyticsModule {}
