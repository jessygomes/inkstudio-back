import { Module } from '@nestjs/common';
import { BlockedTimeSlotsController } from './blocked-time-slots.controller';
import { BlockedTimeSlotsService } from './blocked-time-slots.service';
import { PrismaService } from 'src/database/prisma.service';

@Module({
  controllers: [BlockedTimeSlotsController],
  providers: [BlockedTimeSlotsService, PrismaService],
  exports: [BlockedTimeSlotsService],
})
export class BlockedTimeSlotsModule {}
