import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, UploadReservation } from '@prisma/client';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { hasActiveBusiness } from '../residencies/booking-access';
import { SignedUploadDto } from './uploads.dto';

const MB = 1024 * 1024;
const professional = ['user', 'user_salon', 'user_tatoueur', 'admin'];
const images = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/heic',
  'image/heif',
];
type Tx = Prisma.TransactionClient;
type Prepare = {
  route: string;
  files: { size: number; type: string }[];
  bookingSalonId?: string;
  followUpToken?: string;
  consentClientId?: string;
  guestId?: string;
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('Invalid upload request');
  return value as Record<string, unknown>;
}
function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}
function quota(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return (
    (Number.isSafeInteger(value) && value > 0 && value <= 1024000
      ? value
      : fallback) * MB
  );
}

@Injectable()
export class UploadQuotaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private unpack(
    action: string,
    body: SignedUploadDto,
    signature?: string,
  ): Record<string, unknown> {
    const secret =
      process.env[
        body.application === 'pro'
          ? 'UPLOAD_OWNERSHIP_PRO_SECRET'
          : 'UPLOAD_OWNERSHIP_PUBLIC_SECRET'
      ];
    if (!secret || Buffer.byteLength(secret) < 32)
      throw new ServiceUnavailableException('Upload authorization unavailable');
    const expected = createHmac('sha256', secret)
      .update(
        JSON.stringify([
          'upload-v2',
          action,
          body.application,
          body.payload,
          body.timestamp,
        ]),
      )
      .digest();
    if (
      !signature ||
      !/^[a-f0-9]{64}$/.test(signature) ||
      Math.abs(Date.now() - body.timestamp) > 300000 ||
      !timingSafeEqual(expected, Buffer.from(signature, 'hex'))
    )
      throw new ForbiddenException('Invalid upload signature');
    try {
      return object(JSON.parse(body.payload));
    } catch {
      throw new BadRequestException('Invalid upload request');
    }
  }

  private async lock(tx: Tx, key: string) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`upload-quota:${key}`}, 0))`;
  }

  private async bookingProfile(tx: Tx, id: string) {
    const user = await tx.user.findUnique({
      where: { id },
      include: { saasPlanDetails: true },
    });
    if (
      !user ||
      !professional.includes(user.role) ||
      user.role === 'admin' ||
      user.publicVisibility === 'HIDDEN'
    )
      throw new ForbiddenException('Booking profile unavailable');
    const expired = [
      user.saasPlanUntil,
      user.saasPlanDetails?.endDate,
      ...(user.saasPlanDetails?.planStatus === 'TRIAL'
        ? [user.saasPlanDetails.trialEndDate]
        : []),
    ].some((date) => date && date <= new Date());
    if (
      user.saasPlan !== 'FREE' &&
      user.saasPlanDetails?.currentPlan !== 'FREE' &&
      user.saasPlanDetails?.planStatus !== 'EXPIRED' &&
      !expired
    )
      return;
    if (user.role === 'user_tatoueur' && user.saasPlan === 'FREE') {
      const sponsors = await tx.salonResidency.findMany({
        where: {
          artistId: id,
          endedAt: null,
          salonAllowsPublicBooking: true,
          artistAllowsPublicBooking: true,
        },
        include: { salon: { include: { saasPlanDetails: true } } },
      });
      if (
        sponsors.some(
          (member) =>
            member.salon.publicVisibility !== 'HIDDEN' &&
            hasActiveBusiness(member.salon),
        )
      )
        return;
    }
    throw new ForbiddenException('Booking profile unavailable');
  }

  private async followUp(tx: Tx, where: { token: string } | { id: string }) {
    const record = await tx.followUpRequest.findUnique({ where });
    if (
      !record ||
      record.status !== 'PENDING' ||
      record.submissionId ||
      (record.expiresAt && record.expiresAt <= new Date())
    )
      throw new ForbiddenException('Follow-up unavailable');
    return record;
  }

  private async revalidate(
    tx: Tx,
    row: Pick<UploadReservation, 'ownerUserId' | 'contextType' | 'contextId'>,
  ) {
    if (row.contextType === 'follow-up') {
      await this.followUp(tx, { id: row.contextId! });
      return;
    }
    if (row.contextType === 'booking') {
      await this.bookingProfile(tx, row.contextId!);
      return;
    }
    const user = row.ownerUserId
      ? await tx.user.findUnique({ where: { id: row.ownerUserId } })
      : null;
    if (!user || ![...professional, 'client'].includes(user.role))
      throw new ForbiddenException('Upload account unavailable');
    if (
      ['documents', 'consent', 'pro-account'].includes(row.contextType) &&
      !professional.includes(user.role)
    )
      throw new ForbiddenException('Professional account required');
    if (
      row.contextType === 'consent' &&
      !(await tx.client.findFirst({
        where: { id: row.contextId!, userId: user.id },
        select: { id: true },
      }))
    )
      throw new ForbiddenException('Client not owned by this account');
  }

  async prepare(
    body: SignedUploadDto,
    signature?: string,
    authorization?: string,
  ) {
    const raw = this.unpack('prepare', body, signature);
    if (
      Object.keys(raw).some(
        (key) =>
          ![
            'route',
            'files',
            'bookingSalonId',
            'followUpToken',
            'consentClientId',
            'guestId',
          ].includes(key),
      ) ||
      !['imageUploader', 'salonDocuments', 'consentPdf'].includes(
        String(raw.route),
      ) ||
      !Array.isArray(raw.files) ||
      raw.files.length < 1 ||
      raw.files.length > (raw.route === 'imageUploader' ? 5 : 1)
    )
      throw new BadRequestException('Invalid upload input');
    for (const key of [
      'bookingSalonId',
      'followUpToken',
      'consentClientId',
      'guestId',
    ])
      if (raw[key] !== undefined && !identifier(raw[key]))
        throw new BadRequestException('Invalid upload context');
    const input = raw as unknown as Prepare;
    const max = input.route === 'salonDocuments' ? 32 * MB : 8 * MB;
    for (const file of input.files) {
      const entry = object(file);
      if (
        !Number.isSafeInteger(entry.size) ||
        Number(entry.size) < 1 ||
        Number(entry.size) > max ||
        !(
          images.includes(String(entry.type)) ||
          (input.route !== 'imageUploader' && entry.type === 'application/pdf')
        ) ||
        (input.route === 'consentPdf' && entry.type !== 'application/pdf')
      )
        throw new BadRequestException('Unsupported upload file');
    }
    let ownerUserId: string | null = null;
    if (authorization !== undefined) {
      try {
        if (!/^Bearer \S+$/.test(authorization) || !process.env.JWT_SECRET)
          throw new Error();
        const principal = await this.jwt.verifyAsync<{ userId?: string }>(
          authorization.slice(7),
          { secret: process.env.JWT_SECRET },
        );
        if (!identifier(principal.userId)) throw new Error();
        ownerUserId = principal.userId;
      } catch {
        throw new UnauthorizedException('Invalid upload credentials');
      }
    }
    return this.prisma.$transaction(
      async (tx) => {
        let contextType: string,
          contextId: string | null = null,
          budgetKey: string;
        const user = ownerUserId
          ? await tx.user.findUnique({ where: { id: ownerUserId } })
          : null;
        if (ownerUserId && !user) throw new UnauthorizedException();
        if (input.followUpToken) {
          if (
            body.application !== 'pro' ||
            input.route !== 'imageUploader' ||
            input.bookingSalonId ||
            input.consentClientId
          )
            throw new ForbiddenException();
          const follow = await this.followUp(tx, {
            token: input.followUpToken,
          });
          ownerUserId = null;
          contextType = 'follow-up';
          contextId = follow.id;
          budgetKey = `follow-up:${follow.id}`;
        } else if (ownerUserId && user) {
          if (input.bookingSalonId || input.guestId)
            throw new BadRequestException('Unexpected guest context');
          if (
            ![...professional, 'client'].includes(user.role) ||
            ((body.application === 'pro' || input.route !== 'imageUploader') &&
              !professional.includes(user.role))
          )
            throw new ForbiddenException('Upload role not allowed');
          if (input.route !== 'imageUploader' && body.application !== 'pro')
            throw new ForbiddenException();
          contextType =
            input.route === 'consentPdf'
              ? 'consent'
              : input.route === 'salonDocuments'
                ? 'documents'
                : body.application === 'pro'
                  ? 'pro-account'
                  : 'account';
          if (contextType === 'consent') {
            if (!input.consentClientId)
              throw new ForbiddenException('Client context required');
            contextId = input.consentClientId;
          } else if (input.consentClientId)
            throw new BadRequestException('Unexpected client context');
          budgetKey = `user:${ownerUserId}`;
        } else {
          if (
            body.application !== 'public' ||
            input.route !== 'imageUploader' ||
            !input.bookingSalonId ||
            !input.guestId ||
            input.consentClientId
          )
            throw new ForbiddenException('Authorized guest context required');
          contextType = 'booking';
          contextId = input.bookingSalonId;
          budgetKey = `guest:${createHash('sha256').update(input.guestId).digest('hex')}`;
        }
        // Global guest lock precedes the per-account/context lock everywhere.
        if (!ownerUserId) await this.lock(tx, 'guest-pool');
        await this.lock(tx, budgetKey);
        await this.revalidate(tx, { ownerUserId, contextType, contextId });
        const startOfDay = new Date();
        startOfDay.setUTCHours(0, 0, 0, 0);
        const where = { budgetKey, status: { not: 'DELETED' } };
        const [total, day] = await Promise.all([
          tx.uploadReservation.aggregate({ where, _sum: { bytes: true } }),
          tx.uploadReservation.aggregate({
            where: { budgetKey, createdAt: { gte: startOfDay } },
            _sum: { bytes: true },
            _count: true,
          }),
        ]);
        const requested = input.files.length * max;
        const category = !ownerUserId
          ? 'GUEST'
          : user?.role === 'client'
            ? 'CLIENT'
            : 'PRO';
        const limit = quota(
          `UPLOAD_${category}_TOTAL_MB`,
          category === 'PRO' ? 2048 : category === 'CLIENT' ? 256 : 40,
        );
        const daily = quota(
          `UPLOAD_${category}_DAILY_MB`,
          category === 'PRO' ? 512 : category === 'CLIENT' ? 128 : 40,
        );
        if (
          (total._sum.bytes || 0) + requested > limit ||
          (day._sum.bytes || 0) + requested > daily ||
          day._count + input.files.length >
            (category === 'PRO' ? 200 : category === 'CLIENT' ? 40 : 10)
        )
          throw new ConflictException('Upload quota exceeded');
        if (!ownerUserId) {
          const pool = await tx.uploadReservation.aggregate({
            where: { ownerUserId: null, status: { not: 'DELETED' } },
            _sum: { bytes: true },
            _count: true,
          });
          if (
            (pool._sum.bytes || 0) + requested >
              quota('UPLOAD_GUEST_POOL_MB', 20480) ||
            pool._count + input.files.length >
              (Number.isSafeInteger(
                Number(process.env.UPLOAD_GUEST_POOL_FILES),
              ) &&
              Number(process.env.UPLOAD_GUEST_POOL_FILES) > 0 &&
              Number(process.env.UPLOAD_GUEST_POOL_FILES) <= 1000000
                ? Number(process.env.UPLOAD_GUEST_POOL_FILES)
                : 10000)
          )
            throw new ConflictException('Guest upload capacity unavailable');
        }
        const reservations: string[] = [];
        for (const file of input.files) {
          const row = await tx.uploadReservation.create({
            data: {
              application: body.application,
              ownerUserId,
              budgetKey,
              contextType,
              contextId,
              bytes: max,
              contentType: file.type,
              expiresAt: new Date(Date.now() + 20 * 60000),
            },
          });
          reservations.push(row.id);
        }
        return { reservations, ownerUserId };
      },
      { timeout: 20000 },
    );
  }

  async complete(body: SignedUploadDto, signature?: string) {
    const data = this.unpack('complete', body, signature);
    if (
      !identifier(data.id) ||
      typeof data.key !== 'string' ||
      !/^[a-zA-Z0-9_.-]{1,512}$/.test(data.key) ||
      !Number.isSafeInteger(data.size) ||
      Number(data.size) < 1
    )
      throw new BadRequestException('Invalid upload completion');
    return this.prisma.$transaction(
      async (tx) => {
        const row = await tx.uploadReservation.findUnique({
          where: { id: data.id as string },
        });
        if (!row || row.application !== body.application)
          throw new ForbiddenException('Unknown upload authorization');
        if (!row.ownerUserId) await this.lock(tx, 'guest-pool');
        await this.lock(tx, row.budgetKey);
        const current = await tx.uploadReservation.findUniqueOrThrow({
          where: { id: row.id },
        });
        if (
          current.status === 'COMPLETE' &&
          current.key === data.key &&
          current.bytes === data.size
        )
          return { success: true };
        if (
          current.status !== 'RESERVED' ||
          current.expiresAt <= new Date() ||
          Number(data.size) > current.bytes
        )
          throw new ForbiddenException(
            'Upload authorization expired or consumed',
          );
        await this.revalidate(tx, current);
        if (current.ownerUserId) {
          const file = await tx.uploadedFile.upsert({
            where: {
              application_key: {
                application: body.application,
                key: data.key as string,
              },
            },
            create: {
              application: body.application,
              key: data.key as string,
              ownerUserId: current.ownerUserId,
            },
            update: {},
          });
          if (file.ownerUserId !== current.ownerUserId)
            throw new ForbiddenException('File ownership cannot be reassigned');
        }
        await tx.uploadReservation.update({
          where: { id: current.id, status: 'RESERVED' },
          data: {
            key: data.key as string,
            bytes: Number(data.size),
            status: 'COMPLETE',
          },
        });
        return { success: true };
      },
      { timeout: 20000 },
    );
  }

  async deleted(body: SignedUploadDto, signature?: string) {
    const data = this.unpack('deleted', body, signature);
    if (
      !Array.isArray(data.keys) ||
      data.keys.length > 100 ||
      data.keys.some(
        (key) =>
          typeof key !== 'string' || !/^[a-zA-Z0-9_.-]{1,512}$/.test(key),
      )
    )
      throw new BadRequestException();
    // Receipt is emitted only after the frontend storage API confirms deletion.
    await this.prisma.uploadReservation.updateMany({
      where: {
        application: body.application,
        key: { in: data.keys as string[] },
        status: 'COMPLETE',
      },
      data: { status: 'CLEANING' },
    });
    return { success: true };
  }

  async abandoned(body: SignedUploadDto, signature?: string) {
    const data = this.unpack('abandoned', body, signature);
    if (
      Object.keys(data).some(
        (key) => !['claim', 'confirmedIds'].includes(key),
      ) ||
      (data.claim !== undefined && typeof data.claim !== 'boolean')
    )
      throw new BadRequestException();
    if (
      data.confirmedIds !== undefined &&
      (!Array.isArray(data.confirmedIds) ||
        data.confirmedIds.length > 100 ||
        !data.confirmedIds.every(identifier))
    )
      throw new BadRequestException();
    const cutoff = new Date(Date.now() - 24 * 3600000);
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, 'guest-pool');
      if (Array.isArray(data.confirmedIds))
        await tx.uploadReservation.updateMany({
          where: {
            application: body.application,
            id: { in: data.confirmedIds as string[] },
            status: 'CLEANING',
            attachedAt: null,
            createdAt: { lt: cutoff },
          },
          data: { status: 'DELETED' },
        });
      const where: Prisma.UploadReservationWhereInput = {
        application: body.application,
        createdAt: { lt: cutoff },
        OR: [
          { status: 'RESERVED' },
          { status: 'CLEANING', attachedAt: null },
          { status: 'COMPLETE', ownerUserId: null, attachedAt: null },
        ],
      };
      const rows = await tx.uploadReservation.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        take: 100,
      });
      if (data.claim === true && rows.length)
        await tx.uploadReservation.updateMany({
          where: { id: { in: rows.map((row) => row.id) }, attachedAt: null },
          data: { status: 'CLEANING' },
        });
      return rows.map((row) => ({ id: row.id, createdAt: row.createdAt }));
    });
  }
}
