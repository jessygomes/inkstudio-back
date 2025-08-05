import { Module } from '@nestjs/common';
import { PortfolioController } from './portfolio.controller';
import { PortfolioService } from './portfolio.service';
import { PrismaService } from 'src/database/prisma.service';
import { SaasModule } from 'src/saas/saas.module';

@Module({
  imports: [SaasModule],
  controllers: [PortfolioController],
  providers: [PortfolioService, PrismaService],
  exports: [PortfolioService, PrismaService], // Exporting the service if needed in other modules
})
export class PortfolioModule {}
