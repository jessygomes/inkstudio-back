import { MailModule } from '../email/mail.module';
import { SaasTrialReminderService } from './saas-trial-reminder.service';
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { SaasService } from './saas.service';
import { PrismaModule } from '../database/prisma.module';
import { SaasController } from './saas.controller';
import { SaasLimitGuard } from './saas-limit.guard';
import { SaasBillingScheduler } from './saas-billing.scheduler';
import { SaasBillingJob } from './saas-billing.job';

@Module({
  imports: [MailModule, PrismaModule, BullModule.registerQueue({ name: 'saas-billing' })],
  providers: [
    SaasService,
    SaasLimitGuard,
    SaasBillingScheduler,
    SaasBillingJob,
    SaasTrialReminderService,
  ],
  controllers: [SaasController],
  exports: [SaasService, SaasLimitGuard],
})
export class SaasModule {}
