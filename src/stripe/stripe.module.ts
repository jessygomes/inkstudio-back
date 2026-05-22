import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/database/prisma.module';
import { SaasModule } from 'src/saas/saas.module';
import { MailModule } from 'src/email/mail.module';
import { StripeController } from './stripe.controller';
import { StripeService } from './stripe.service';

@Module({
  imports: [PrismaModule, SaasModule, MailModule],
  controllers: [StripeController],
  providers: [StripeService],
  exports: [StripeService],
})
export class StripeModule {}
