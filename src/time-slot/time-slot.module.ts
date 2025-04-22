import { Module } from '@nestjs/common';
import { TimeSlotService } from './time-slot.service';
import { TimeSlotController } from './time-slot.controller';
import { PrismaService } from 'src/database/prisma.service';

@Module({
  providers: [TimeSlotService, PrismaService],
  controllers: [TimeSlotController],
})
export class TimeSlotModule {}
