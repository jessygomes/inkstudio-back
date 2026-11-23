import { Module } from '@nestjs/common';
import { PrismaModule } from '../database/prisma.module';
import { MailModule } from '../email/mail.module';
import { CacheService } from '../redis/cache.service';
import { SaasModule } from '../saas/saas.module';
import { StripeModule } from '../stripe/stripe.module';
import { GiveawayAdminGuard } from './giveaway-admin.guard';
import { GiveawayAuditService } from './giveaway-audit.service';
import { GiveawayEligibilityService } from './giveaway-eligibility.service';
import { GiveawayMailerService } from './giveaway-mailer.service';
import { GiveawaysAdminController } from './giveaways-admin.controller';
import { GiveawaysAdminService } from './giveaways-admin.service';
import { GiveawaysController } from './giveaways.controller';
import { GiveawaysService } from './giveaways.service';
import { SubscriptionGrantsService } from './subscription-grants.service';

@Module({
  imports: [PrismaModule, MailModule, SaasModule, StripeModule],
  controllers: [GiveawaysController, GiveawaysAdminController],
  providers: [
    CacheService,
    GiveawayAdminGuard,
    GiveawayAuditService,
    GiveawayEligibilityService,
    GiveawayMailerService,
    GiveawaysService,
    GiveawaysAdminService,
    SubscriptionGrantsService,
  ],
  exports: [GiveawayEligibilityService, SubscriptionGrantsService],
})
export class GiveawaysModule {}
