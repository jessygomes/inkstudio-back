import { Module } from '@nestjs/common';
import { PrismaModule } from '../database/prisma.module';
import { MailModule } from '../email/mail.module';
import { ClientInvitationsController } from './client-invitations.controller';
import { ClientInvitationsService } from './client-invitations.service';

@Module({
  imports: [PrismaModule, MailModule],
  controllers: [ClientInvitationsController],
  providers: [ClientInvitationsService],
  exports: [ClientInvitationsService],
})
export class ClientInvitationsModule {}
