import {
  ExecutionContext,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../database/prisma.service';
import { PublicProfileAccessGuard } from './public-profile-access';
import {
  publicDisplayName,
  publicProfessionalProfileWhere,
  withPublicName,
} from './public-profile.utils';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateUserDto } from './dto/update-user.dto';

describe('public profile identity and access', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    tatoueur: { findUnique: jest.fn() },
  };
  const reflector = { get: jest.fn() };
  const guard = new PublicProfileAccessGuard(
    reflector as unknown as Reflector,
    prisma as unknown as PrismaService,
  );
  let authenticate: jest.SpyInstance;
  function context(user?: { userId: string; role: string }): ExecutionContext {
    return {
      getHandler: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ params: { userId: 'professional' }, user }),
      }),
    } as unknown as ExecutionContext;
  }
  beforeEach(() => {
    jest.clearAllMocks();
    authenticate = jest
      .spyOn(
        Object.getPrototypeOf(PublicProfileAccessGuard.prototype),
        'canActivate',
      )
      .mockResolvedValue(true);
    reflector.get.mockReturnValue({
      key: 'userId',
      resource: 'user',
      source: 'params',
    });
  });
  afterEach(() => authenticate.mockRestore());

  it.each(['VISIBLE', 'SEARCH_HIDDEN'])(
    'keeps direct profile access for %s',
    async (publicVisibility) => {
      prisma.user.findUnique.mockResolvedValue({ publicVisibility });
      await expect(guard.canActivate(context())).resolves.toBe(true);
    },
  );
  it.each([undefined, { userId: 'other', role: 'client' }])(
    'returns 404 for a hidden profile to visitors and other clients',
    async (user) => {
      prisma.user.findUnique.mockResolvedValue({ publicVisibility: 'HIDDEN' });
      await expect(guard.canActivate(context(user))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    },
  );
  it.each([
    { userId: 'professional', role: 'user_salon' },
    { userId: 'admin', role: 'admin' },
  ])('preserves authenticated owner and admin access', async (user) => {
    prisma.user.findUnique.mockResolvedValue({ publicVisibility: 'HIDDEN' });
    await expect(guard.canActivate(context(user))).resolves.toBe(true);
  });
  it('also blocks assets accessed through an internal artist ID', async () => {
    reflector.get.mockReturnValue({
      key: 'userId',
      resource: 'tatoueur',
      source: 'params',
    });
    prisma.tatoueur.findUnique.mockResolvedValue({ userId: 'hidden-owner' });
    prisma.user.findUnique.mockResolvedValue({ publicVisibility: 'HIDDEN' });
    await expect(guard.canActivate(context())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'hidden-owner' },
      select: { publicVisibility: true },
    });
  });
  it('resolves linked artist identifiers before checking visibility', async () => {
    reflector.get.mockReturnValue({
      key: 'userId',
      resource: 'tatoueur',
      source: 'params',
    });
    prisma.tatoueur.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({ publicVisibility: 'HIDDEN' });
    const ctx = {
      getHandler: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ params: { userId: 'linked_artist' } }),
      }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'artist' },
      select: { publicVisibility: true },
    });
  });
  it('checks both the artist and the venue in a public booking request', async () => {
    reflector.get.mockReturnValue([
      { key: 'userId', resource: 'user', source: 'body' },
      { key: 'rdvBody.venueSalonId', resource: 'user', source: 'body' },
    ]);
    prisma.user.findUnique
      .mockResolvedValueOnce({ publicVisibility: 'VISIBLE' })
      .mockResolvedValueOnce({ publicVisibility: 'HIDDEN' });
    const ctx = {
      getHandler: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          body: { userId: 'artist', rdvBody: { venueSalonId: 'venue' } },
        }),
      }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.user.findUnique).toHaveBeenLastCalledWith({
      where: { id: 'venue' },
      select: { publicVisibility: true },
    });
  });
  it('does not run authentication on unrelated private routes', async () => {
    reflector.get.mockReturnValue(undefined);
    await expect(guard.canActivate(context())).resolves.toBe(true);
    expect(authenticate).not.toHaveBeenCalled();
  });
  it('uses different visibility filters for discovery and direct profile access', () => {
    expect(publicProfessionalProfileWhere().publicVisibility).toBe('VISIBLE');
    expect(publicProfessionalProfileWhere(false).publicVisibility).toEqual({
      not: 'HIDDEN',
    });
  });
  it('uses an independent nickname without changing their legal identity or URL name', () => {
    const user = {
      role: 'user_tatoueur',
      nickname: '  Encre Bleue ',
      salonName: 'Jean Dupont',
      firstName: 'Jean',
      lastName: 'Dupont',
    };
    expect(withPublicName(user)).toEqual({
      ...user,
      displayName: 'Encre Bleue',
    });
    expect(publicDisplayName({ ...user, nickname: '' })).toBe('Jean Dupont');
    expect(publicDisplayName({ ...user, role: 'user_salon' })).toBe(
      'Jean Dupont',
    );
  });
  it('does not allow a nickname to replace required legal first and last names', async () => {
    const input = plainToInstance(UpdateUserDto, {
      nickname: 'Artiste',
      firstName: '  ',
      lastName: '  ',
    });
    const errors = await validate(input);
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['firstName', 'lastName']),
    );
  });
  it('limits nickname length', async () => {
    const errors = await validate(
      plainToInstance(UpdateUserDto, { nickname: 'a'.repeat(81) }),
    );
    expect(errors.some((error) => error.property === 'nickname')).toBe(true);
  });
  it('strips visibility from the account owner update payload', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const result: unknown = await pipe.transform(
      {
        firstName: 'Jean',
        lastName: 'Dupont',
        salonName: 'Artiste',
        phone: '0102030405',
        address: '',
        city: 'Paris',
        postalCode: '75001',
        prestations: [],
        nickname: 'Blue',
        publicVisibility: 'VISIBLE',
      },
      { type: 'body', metatype: UpdateUserDto },
    );
    expect(result).not.toHaveProperty('publicVisibility');
    expect(result).toMatchObject({
      nickname: 'Blue',
      firstName: 'Jean',
      lastName: 'Dupont',
    });
  });
});
