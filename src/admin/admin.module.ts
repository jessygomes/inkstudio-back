import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { PrismaService } from 'src/database/prisma.service';
import { CacheService } from 'src/redis/cache.service';
import { MailModule } from 'src/email/mail.module';
import { SubscriptionInvitationsService } from './subscription-invitations.service';
import { SaasModule } from 'src/saas/saas.module';

@Module({
  imports: [MailModule, SaasModule],
  controllers: [AdminController],
  providers: [AdminService, PrismaService, CacheService, SubscriptionInvitationsService],
})
export class AdminModule {}
