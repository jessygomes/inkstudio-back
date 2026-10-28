import { Module } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { SuiviController } from './suivi.controller';
import { SuiviService } from './suivi.service';
import { MailModule } from 'src/email/mail.module';
import { MessagingModule } from 'src/messaging/messaging.module';
import { DrawingDeliveryService } from './drawing-delivery.service';

// Module dédié au tableau Kanban des cards de dessin.
@Module({
  imports: [MailModule, MessagingModule],
  controllers: [SuiviController],
  providers: [SuiviService, DrawingDeliveryService, PrismaService],
  exports: [SuiviService],
})
export class SuiviModule {}
