import { Module } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { SuiviController } from './suivi.controller';
import { SuiviService } from './suivi.service';

// Module dédié au tableau Kanban des cards de dessin.
@Module({
  controllers: [SuiviController],
  providers: [SuiviService, PrismaService],
  exports: [SuiviService],
})
export class SuiviModule {}
