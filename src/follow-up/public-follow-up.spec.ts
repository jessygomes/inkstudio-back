import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FollowupsController } from './follow-up.controller';
import { SubmitFollowUpDto } from './dto/submit-follow-up.dto';

describe('Public follow-up response from email', () => {
  let prisma: any;
  let controller: FollowupsController;
  let request: any;
  const input = {
    token: 'email-token',
    photoUrl: 'https://cdn.example.com/photo.webp',
    rating: 4,
    review: 'Tout va bien.',
  };
  beforeEach(() => {
    request = {
      id: 'request',
      token: 'email-token',
      appointmentId: 'appointment',
      status: 'SENT',
      submission: null,
      submissionId: null,
      expiresAt: new Date(Date.now() + 86_400_000),
      appointment: {
        id: 'appointment',
        userId: 'salon',
        clientId: 'client',
        title: 'Projet floral',
        prestation: 'TATTOO',
        start: new Date('2026-10-20T12:00:00Z'),
        user: { salonName: 'Atelier Luna' },
        performerUser: null,
        tatoueur: { name: 'Luna' },
      },
    };
    prisma = {
      $queryRaw: jest.fn(),
      $transaction: jest.fn(),
      followUpRequest: {
        findUnique: jest.fn(async () => request),
        update: jest.fn(async ({ data }) => {
          Object.assign(request, data);
          return request;
        }),
      },
      followUpSubmission: {
        create: jest.fn().mockResolvedValue({ id: 'submission' }),
      },
    };
    prisma.$transaction.mockImplementation(async (callback) =>
      callback(prisma),
    );
    controller = new FollowupsController(prisma, {} as any);
  });
  it('validates a usable token and returns only appointment context needed by the page', async () => {
    const result = await controller.validateToken('email-token');
    expect(result).toMatchObject({
      ok: true,
      appointment: {
        title: 'Projet floral',
        salonName: 'Atelier Luna',
        artistName: 'Luna',
      },
    });
    expect(result).not.toHaveProperty('token');
    expect(result.appointment).not.toHaveProperty('clientId');
    expect(result.appointment).not.toHaveProperty('userId');
  });
  it('rejects invalid, expired and already submitted links', async () => {
    prisma.followUpRequest.findUnique.mockResolvedValueOnce(null);
    await expect(controller.validateToken('invalid')).rejects.toThrow(
      'Lien invalide',
    );
    request.expiresAt = new Date(0);
    await expect(controller.validateToken('expired')).rejects.toThrow(
      'Lien expiré',
    );
    request.status = 'SUBMITTED';
    await expect(controller.validateToken('used')).rejects.toThrow(
      'Déjà soumis',
    );
  });
  it('distinguishes temporary service errors so the page can offer a retry', async () => {
    prisma.followUpRequest.findUnique.mockRejectedValue(
      new Error('database unavailable'),
    );
    await expect(controller.validateToken('token')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
  it('saves the photo, rating and review under the RDV salon and keeps the photo private by default', async () => {
    await expect(
      controller.submit({
        ...input,
        userId: 'foreign-salon',
      } as SubmitFollowUpDto),
    ).resolves.toEqual({ ok: true });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.followUpSubmission.create).toHaveBeenCalledWith({
      data: {
        appointmentId: 'appointment',
        clientId: 'client',
        userId: 'salon',
        photoUrl: input.photoUrl,
        rating: 4,
        review: input.review,
        isPhotoPublic: false,
      },
    });
    expect(prisma.followUpRequest.update).toHaveBeenCalledWith({
      where: { token: 'email-token' },
      data: { status: 'SUBMITTED', submissionId: 'submission' },
    });
  });
  it('requires an explicit opt-in to save the photo as public', async () => {
    await controller.submit({ ...input, isPhotoPublic: true });
    expect(prisma.followUpSubmission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isPhotoPublic: true }),
      }),
    );
  });
  it('refuses another submission with the same token', async () => {
    await controller.submit(input);
    await expect(controller.submit(input)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.followUpSubmission.create).toHaveBeenCalledTimes(1);
  });
  it('does not create a submission for an expired or missing request', async () => {
    request.expiresAt = new Date(0);
    await expect(controller.submit(input)).rejects.toThrow('Lien expiré');
    prisma.followUpRequest.findUnique.mockResolvedValueOnce(null);
    await expect(controller.submit(input)).rejects.toThrow('Token invalide');
    expect(prisma.followUpSubmission.create).not.toHaveBeenCalled();
  });
  it('rejects invalid ratings, non-HTTPS photos and string-valued consent at the API boundary', async () => {
    expect(
      await validate(plainToInstance(SubmitFollowUpDto, input)),
    ).toHaveLength(0);
    const errors = await validate(
      plainToInstance(SubmitFollowUpDto, {
        ...input,
        rating: 2.5,
        photoUrl: 'javascript:alert(1)',
        isPhotoPublic: 'false',
        review: 'a'.repeat(5001),
      }),
    );
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['rating', 'photoUrl', 'isPhotoPublic', 'review']),
    );
  });
});
