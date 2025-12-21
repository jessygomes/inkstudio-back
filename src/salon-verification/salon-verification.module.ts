import { Module } from '@nestjs/common';
import { SalonVerificationService } from './salon-verification.service';
import { SalonVerificationController } from './salon-verification.controller';
import { PrismaService } from 'src/database/prisma.service';

@Module({
  controllers: [SalonVerificationController],
  providers: [SalonVerificationService, PrismaService],
})
export class SalonVerificationModule {}
