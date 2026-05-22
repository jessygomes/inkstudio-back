import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { SaasService } from './saas.service';
import { PrismaModule } from '../database/prisma.module';
import { SaasController } from './saas.controller';
import { SaasLimitGuard } from './saas-limit.guard';
import { SaasBillingScheduler } from './saas-billing.scheduler';
import { SaasBillingJob } from './saas-billing.job';

@Module({
  imports: [PrismaModule, BullModule.registerQueue({ name: 'saas-billing' })],
  providers: [
    SaasService,
    SaasLimitGuard,
    SaasBillingScheduler,
    SaasBillingJob,
  ],
  controllers: [SaasController],
  exports: [SaasService, SaasLimitGuard],
})
export class SaasModule {}
