import { Body, Controller, Header, Headers, Post } from '@nestjs/common';
import { SecurityThrottle } from '../auth/security-throttle';
import { SignedUploadDto } from './uploads.dto';
import { UploadQuotaService } from './upload-quota.service';

@Controller('uploads')
export class UploadQuotaController {
  constructor(private readonly uploads: UploadQuotaService) {}
  @Post('prepare')
  @SecurityThrottle('upload')
  @Header('Cache-Control', 'private, no-store')
  prepare(
    @Body() body: SignedUploadDto,
    @Headers('x-upload-signature') signature?: string,
    @Headers('authorization') authorization?: string,
  ) {
    return this.uploads.prepare(body, signature, authorization);
  }
  @Post('complete')
  @Header('Cache-Control', 'private, no-store')
  complete(
    @Body() body: SignedUploadDto,
    @Headers('x-upload-signature') signature?: string,
  ) {
    return this.uploads.complete(body, signature);
  }
  @Post('deleted')
  @Header('Cache-Control', 'private, no-store')
  deleted(
    @Body() body: SignedUploadDto,
    @Headers('x-upload-signature') signature?: string,
  ) {
    return this.uploads.deleted(body, signature);
  }
  @Post('abandoned')
  @Header('Cache-Control', 'private, no-store')
  abandoned(
    @Body() body: SignedUploadDto,
    @Headers('x-upload-signature') signature?: string,
  ) {
    return this.uploads.abandoned(body, signature);
  }
}
