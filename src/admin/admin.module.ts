import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { PrismaService } from 'src/database/prisma.service';
import { CacheService } from 'src/redis/cache.service';
import { MailModule } from 'src/email/mail.module';

@Module({
  imports: [MailModule],
  controllers: [AdminController],
  providers: [AdminService, PrismaService, CacheService],
})
export class AdminModule {}
