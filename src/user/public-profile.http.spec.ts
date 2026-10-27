import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Server } from 'node:http';
import request from 'supertest';
import { PrismaService } from '../database/prisma.service';
import { JwtStrategy } from '../auth/jwt.strategy';
import {
  PublicProfile,
  PublicProfileAccessModule,
} from './public-profile-access';

@Controller('visibility-fixture')
class ProfileFixtureController {
  @PublicProfile()
  @Get(':userId')
  profile() {
    return { accessible: true };
  }
}

describe('public profile HTTP access with real JWT authentication', () => {
  let app: INestApplication<Server>;
  let jwt: JwtService;
  const prisma = { user: { findUnique: jest.fn() } };
  const originalSecret = process.env.JWT_SECRET;
  beforeAll(async () => {
    process.env.JWT_SECRET = 'profile-visibility-test-only';
    const module = await Test.createTestingModule({
      imports: [
        PublicProfileAccessModule,
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({ secret: process.env.JWT_SECRET }),
      ],
      controllers: [ProfileFixtureController],
      providers: [JwtStrategy],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = module.createNestApplication();
    await app.init();
    jwt = module.get(JwtService);
  });
  afterAll(async () => {
    await app?.close();
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });
  beforeEach(() =>
    prisma.user.findUnique.mockResolvedValue({ publicVisibility: 'HIDDEN' }),
  );

  it('returns 404 to anonymous visitors and invalid tokens', async () => {
    await request(app.getHttpServer())
      .get('/visibility-fixture/owner')
      .expect(404);
    await request(app.getHttpServer())
      .get('/visibility-fixture/owner')
      .set('Authorization', 'Bearer invalid')
      .expect(404);
  });
  it('accepts a signed owner or admin token while rejecting other accounts', async () => {
    for (const [userId, role, status] of [
      ['owner', 'user_salon', 200],
      ['administrator', 'admin', 200],
      ['other', 'client', 404],
    ] as const) {
      await request(app.getHttpServer())
        .get('/visibility-fixture/owner')
        .set('Authorization', 'Bearer ' + jwt.sign({ userId, role }))
        .expect(status);
    }
  });
  it.each(['VISIBLE', 'SEARCH_HIDDEN'])(
    'allows public access to %s profiles',
    async (publicVisibility) => {
      prisma.user.findUnique.mockResolvedValue({ publicVisibility });
      await request(app.getHttpServer())
        .get('/visibility-fixture/owner')
        .expect(200, { accessible: true });
    },
  );
});
