/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { TattooHistoryController } from './tattoo-history.controller';
import { TattooHistoryService } from './tattoo-history.service';
import { PrismaService } from 'src/database/prisma.service';

@Module({
  controllers: [TattooHistoryController],
  providers: [TattooHistoryService, PrismaService],
})
export class TattooHistoryModule {}
