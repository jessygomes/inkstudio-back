import { Module } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { TatoueursController } from './tatoueurs.controller';
import { TatoueursService } from './tatoueurs.service';
import { SaasModule } from 'src/saas/saas.module';

@Module({
  imports: [SaasModule],
  controllers: [TatoueursController],
  providers: [TatoueursService, PrismaService],
})
export class TatoueursModule {}
