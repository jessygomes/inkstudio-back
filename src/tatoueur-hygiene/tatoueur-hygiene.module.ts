import { Module } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { AdminTatoueurHygieneController, TatoueurHygieneController } from './tatoueur-hygiene.controller';
import { TatoueurHygieneService } from './tatoueur-hygiene.service';

@Module({
  controllers: [TatoueurHygieneController, AdminTatoueurHygieneController],
  providers: [TatoueurHygieneService, PrismaService],
})
export class TatoueurHygieneModule {}
