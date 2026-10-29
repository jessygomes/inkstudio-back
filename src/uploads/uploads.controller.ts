import {
  Body,
  Controller,
  Header,
  Headers,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequestWithUser } from '../auth/jwt.strategy';
import {
  AuthorizeFileDeletionDto,
  RegisterUploadedFileDto,
} from './uploads.dto';
import { UploadsService } from './uploads.service';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('register')
  @Header('Cache-Control', 'private, no-store')
  register(
    @Body() body: RegisterUploadedFileDto,
    @Headers('x-upload-signature') signature?: string,
  ) {
    return this.uploads.register(body, signature);
  }

  @Post('authorize-deletion')
  @UseGuards(JwtAuthGuard)
  @Header('Cache-Control', 'private, no-store')
  authorize(
    @Body() body: AuthorizeFileDeletionDto,
    @Request() req: RequestWithUser,
  ) {
    return this.uploads.authorize(body, req.user);
  }
}
