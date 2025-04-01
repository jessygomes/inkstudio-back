import { Module } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { TatoueursController } from './tatoueurs.controller';
import { TatoueursService } from './tatoueurs.service';

@Module({
  controllers: [TatoueursController],
  providers: [TatoueursService, PrismaService],
})
export class TatoueursModule {}
