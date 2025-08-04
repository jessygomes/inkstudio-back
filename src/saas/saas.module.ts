import { Module } from '@nestjs/common';
import { SaasService } from './saas.service';
import { PrismaModule } from '../database/prisma.module';
import { SaasController } from './saas.controller';
import { SaasLimitGuard } from './saas-limit.guard';

@Module({
  imports: [PrismaModule],
  providers: [SaasService, SaasLimitGuard],
  controllers: [SaasController],
  exports: [SaasService, SaasLimitGuard],
})
export class SaasModule {}
