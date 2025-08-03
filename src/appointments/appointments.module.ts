/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { PrismaService } from 'src/database/prisma.service';
import { MailService } from 'src/mailer.service';
import { FollowUpModule } from 'src/follow-up/follow-up.module';

@Module({
  imports: [FollowUpModule],
  controllers: [AppointmentsController],
  providers: [AppointmentsService, PrismaService, MailService],
})
export class AppointmentsModule {}
