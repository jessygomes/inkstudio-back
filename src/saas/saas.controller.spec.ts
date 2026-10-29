import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtStrategy } from '../auth/jwt.strategy';
import { SaasController } from './saas.controller';
import { SaasService } from './saas.service';

describe('SaasController access boundaries', () => {
  const secret = 'saas-tests-only-signing-secret';
  const originalSecret = process.env.JWT_SECRET;
  const service = {
    getUserPlanDetails: jest.fn(),
    hasFeature: jest.fn(),
    updateUserPlan: jest.fn(),
    upgradeToMedium: jest.fn(),
    upgradeToPremium: jest.fn(),
    fixExistingPlan: jest.fn(),
  };
  let app: INestApplication;
  let jwt: JwtService;

  beforeAll(async () => {
    process.env.JWT_SECRET = secret;
    const module = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret })],
      controllers: [SaasController],
      providers: [JwtStrategy, { provide: SaasService, useValue: service }],
    }).compile();
    jwt = module.get(JwtService);
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  beforeEach(() => {
    jest.resetAllMocks();
    service.getUserPlanDetails.mockResolvedValue({ currentPlan: 'PRO' });
    service.hasFeature.mockResolvedValue(true);
  });

  afterAll(async () => {
    await app.close();
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });

  const bearer = (role = 'user_salon', userId = 'owner') =>
    `Bearer ${jwt.sign({ userId, role })}`;

  it('requires authentication to read a plan', async () => {
    await request(app.getHttpServer()).get('/saas/plan/owner').expect(401);
    expect(service.getUserPlanDetails).not.toHaveBeenCalled();
  });

  it.each(['forged', 'expired'])(
    'rejects a %s JWT before accessing billing data',
    async (kind) => {
      const token =
        kind === 'forged'
          ? new JwtService({ secret: 'another-test-secret' }).sign({
              userId: 'owner',
              role: 'admin',
            })
          : jwt.sign({ userId: 'owner', role: 'admin' }, { expiresIn: -1 });
      await request(app.getHttpServer())
        .get('/saas/plan/owner')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
      expect(service.getUserPlanDetails).not.toHaveBeenCalled();
    },
  );

  it('allows the owner to read their plan', async () => {
    await request(app.getHttpServer())
      .get('/saas/plan/owner')
      .set('Authorization', bearer())
      .expect(200)
      .expect('Cache-Control', 'private, no-store')
      .expect({ currentPlan: 'PRO' });
    expect(service.getUserPlanDetails).toHaveBeenCalledWith('owner');
  });

  it.each(['user_salon', 'user_tatoueur', 'client'])(
    'denies another account plan to %s',
    async (role) => {
      await request(app.getHttpServer())
        .get('/saas/plan/another-salon')
        .set('Authorization', bearer(role))
        .expect(403);
      expect(service.getUserPlanDetails).not.toHaveBeenCalled();
    },
  );

  it('allows an authenticated administrator to inspect a plan', async () => {
    await request(app.getHttpServer())
      .get('/saas/plan/another-salon')
      .set('Authorization', bearer('admin'))
      .expect(200);
    expect(service.getUserPlanDetails).toHaveBeenCalledWith('another-salon');
  });

  it('requires authentication to check features', async () => {
    await request(app.getHttpServer())
      .post('/saas/check-feature')
      .send({ feature: 'advancedStats' })
      .expect(401);
    expect(service.hasFeature).not.toHaveBeenCalled();
  });

  it.each(['advancedStats', 'emailReminders', 'customBranding', 'apiAccess'])(
    'checks %s only for the authenticated account',
    async (feature) => {
      await request(app.getHttpServer())
        .post('/saas/check-feature')
        .set('Authorization', bearer())
        .send({
          feature,
          userId: 'another-salon',
          role: 'admin',
          plan: 'BUSINESS',
        })
        .expect(201)
        .expect({ feature, available: true });
      expect(service.hasFeature).toHaveBeenCalledWith('owner', feature);
      expect(service.updateUserPlan).not.toHaveBeenCalled();
    },
  );

  it('returns unavailable features without enabling them', async () => {
    service.hasFeature.mockResolvedValue(false);
    await request(app.getHttpServer())
      .post('/saas/check-feature')
      .set('Authorization', bearer())
      .send({ feature: 'apiAccess' })
      .expect(201)
      .expect({ feature: 'apiAccess', available: false });
    expect(service.updateUserPlan).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { feature: 'BUSINESS' },
    { feature: ['apiAccess'] },
    { feature: null },
  ])('rejects invalid feature input %p', async (body) => {
    await request(app.getHttpServer())
      .post('/saas/check-feature')
      .set('Authorization', bearer())
      .send(body)
      .expect(400);
    expect(service.hasFeature).not.toHaveBeenCalled();
  });

  const removedRoutes = [
    ['patch', '/saas/upgrade/owner'],
    ['patch', '/saas/upgrade/another-salon'],
    ['post', '/saas/upgrade-pro'],
    ['post', '/saas/upgrade-business'],
    ['post', '/saas/fix-plan/another-salon'],
  ] as const;
  for (const actor of ['anonymous', 'user_salon', 'client', 'admin']) {
    it.each(removedRoutes)(
      `removes legacy %s %s for ${actor}`,
      async (method, path) => {
        const call = request(app.getHttpServer())[method](path);
        if (actor !== 'anonymous') call.set('Authorization', bearer(actor));
        await call
          .send({
            plan: 'BUSINESS',
            userId: 'another-salon',
            endDate: '2099-01-01',
          })
          .expect(404);
        expect(service.updateUserPlan).not.toHaveBeenCalled();
        expect(service.upgradeToMedium).not.toHaveBeenCalled();
        expect(service.upgradeToPremium).not.toHaveBeenCalled();
        expect(service.fixExistingPlan).not.toHaveBeenCalled();
      },
    );
  }
});
