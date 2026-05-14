import { Module } from '@nestjs/common';
import { SalonAnalyticsService } from './salon-analytics.service';
import { SalonAnalyticsController } from './salon-analytics.controller';

@Module({
  providers: [SalonAnalyticsService],
  controllers: [SalonAnalyticsController],
  exports: [SalonAnalyticsService],
})
export class SalonAnalyticsModule {}
