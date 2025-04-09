import { Module } from '@nestjs/common';
import { AftercareService } from './aftercare.service';
import { AftercareController } from './aftercare.controller';
import { PrismaService } from 'src/database/prisma.service';

@Module({
  providers: [AftercareService, PrismaService],
  controllers: [AftercareController],
})
export class AftercareModule {}
