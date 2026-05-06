import { Module } from '@nestjs/common';
import { MoodboardController } from './moodboard.controller';
import { MoodboardService } from './moodboard.service';
import { PrismaService } from 'src/database/prisma.service';

@Module({
  controllers: [MoodboardController],
  providers: [MoodboardService, PrismaService],
  exports: [MoodboardService],
})
export class MoodboardModule {}
