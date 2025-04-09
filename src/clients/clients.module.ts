/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { PrismaService } from 'src/database/prisma.service';

@Module({
  controllers: [
    ClientsController,
    // MedicalHistoryController,
    // TattooHistoryController,
    // AftercareController,
  ],
  providers: [
    ClientsService,
    // MedicalHistoryService,
    // TattooHistoryService,
    // AftercareService,
    PrismaService,
  ],
})
export class ClientsModule {}
