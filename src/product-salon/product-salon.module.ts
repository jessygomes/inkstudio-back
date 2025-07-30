/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { ProductSalonService } from './product-salon.service';
import { ProductSalonController } from './product-salon.controller';
import { PrismaService } from 'src/database/prisma.service';

@Module({
  controllers: [ProductSalonController],
  providers: [ProductSalonService, PrismaService],
  exports: [ProductSalonService, PrismaService], // Exporting the service if needed in other modules
})
export class ProductSalonModule {}
