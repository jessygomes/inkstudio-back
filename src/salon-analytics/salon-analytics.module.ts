import { Module } from '@nestjs/common';
import { SalonAnalyticsService } from './salon-analytics.service';
import { SalonAnalyticsController } from './salon-analytics.controller';
import { PrismaService } from 'src/database/prisma.service';
import { SaasModule } from 'src/saas/saas.module';

@Module({
  imports: [SaasModule],
  providers: [SalonAnalyticsService, PrismaService],
  controllers: [SalonAnalyticsController],
  exports: [SalonAnalyticsService],
})
export class SalonAnalyticsModule {}
