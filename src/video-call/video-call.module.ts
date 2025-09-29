import { Module } from '@nestjs/common';
import { VideoCallService } from './video-call.service';

@Module({
  providers: [VideoCallService],
  exports: [VideoCallService],
})
export class VideoCallModule {}
