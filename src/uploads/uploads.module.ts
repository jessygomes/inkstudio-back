import { Module } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { SecurityThrottleModule } from '../auth/security-throttle';
import { UploadQuotaService } from './upload-quota.service';
import { UploadQuotaController } from './upload-quota.controller';

@Module({
  imports: [SecurityThrottleModule],
  controllers: [UploadsController, UploadQuotaController],
  providers: [PrismaService, UploadsService, UploadQuotaService],
})
export class UploadsModule {}
