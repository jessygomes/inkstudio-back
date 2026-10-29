import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import {
  AuthorizeFileDeletionDto,
  RegisterUploadedFileDto,
} from './uploads.dto';

@Injectable()
export class UploadsService {
  constructor(private readonly prisma: PrismaService) {}

  async register(body: RegisterUploadedFileDto, signature?: string) {
    const secret =
      process.env[
        body.application === 'pro'
          ? 'UPLOAD_OWNERSHIP_PRO_SECRET'
          : 'UPLOAD_OWNERSHIP_PUBLIC_SECRET'
      ];
    if (!secret || Buffer.byteLength(secret) < 32) {
      throw new ServiceUnavailableException(
        'File ownership registration unavailable',
      );
    }
    const expected = createHmac('sha256', secret)
      .update(
        JSON.stringify([
          body.application,
          body.ownerUserId,
          body.key,
          body.timestamp,
        ]),
      )
      .digest();
    if (
      !signature ||
      !/^[a-f0-9]{64}$/.test(signature) ||
      Math.abs(Date.now() - body.timestamp) > 5 * 60_000 ||
      !timingSafeEqual(expected, Buffer.from(signature, 'hex'))
    ) {
      throw new ForbiddenException('Invalid registration signature');
    }
    const record = await this.prisma.uploadedFile.upsert({
      where: {
        application_key: { application: body.application, key: body.key },
      },
      create: {
        application: body.application,
        key: body.key,
        ownerUserId: body.ownerUserId,
      },
      update: {},
    });
    if (record.ownerUserId !== body.ownerUserId) {
      throw new ForbiddenException('File ownership cannot be reassigned');
    }
    return { success: true };
  }

  async authorize(
    body: AuthorizeFileDeletionDto,
    user: { userId: string; role?: string },
  ) {
    const ownerUserId = body.ownerUserId ?? user.userId;
    if (ownerUserId !== user.userId && user.role !== 'admin') {
      throw new ForbiddenException('File deletion not authorized');
    }
    const files = await this.prisma.uploadedFile.findMany({
      where: { application: body.application, key: { in: body.fileKeys } },
      select: { key: true, ownerUserId: true },
    });
    if (
      files.length !== body.fileKeys.length ||
      files.some((file) => file.ownerUserId !== ownerUserId)
    ) {
      throw new ForbiddenException('File deletion not authorized');
    }
    return { authorized: true };
  }
}
