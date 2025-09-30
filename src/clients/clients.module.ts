import { Module } from '@nestjs/common';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { PrismaService } from 'src/database/prisma.service';
import { SaasModule } from 'src/saas/saas.module';
import { CacheService } from 'src/redis/cache.service';

@Module({
  imports: [SaasModule],
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
    CacheService,
  ],
})
export class ClientsModule {}
