import { Module } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { CacheService } from 'src/redis/cache.service';
import { AppointmentConsumablesController } from './appointment-consumables.controller';
import { AppointmentConsumablesService } from './appointment-consumables.service';

@Module({
  controllers: [AppointmentConsumablesController],
  providers: [AppointmentConsumablesService, PrismaService, CacheService],
  exports: [AppointmentConsumablesService],
})
export class AppointmentConsumablesModule {}
