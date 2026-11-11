import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import request from 'supertest';
import { JwtStrategy } from '../auth/jwt.strategy';
import { SecurityThrottleGuard } from '../auth/security-throttle';
import { BookingLinksController } from './booking-links.controller';
import { BookingLinksService } from './booking-links.service';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { SaasLimitGuard } from '../saas/saas-limit.guard';

describe('Booking link HTTP contract and identity', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const previousSecret = process.env.JWT_SECRET;
  const links = {
    create: jest.fn(),
    list: jest.fn(),
    get: jest.fn(),
    revoke: jest.fn(),
    publicInfo: jest.fn(),
    availability: jest.fn(),
    confirm: jest.fn(),
  };
  const appointments = {
    getOneAppointment: jest.fn(),
    assertAppointmentAccess: jest.fn(),
    updateDesiredTattooPeriod: jest.fn(),
  };
  const token = 'a'.repeat(43);
  const body = {
    start: '2030-01-07T09:00:00Z',
    rdvBody: {
      clientFirstname: 'Alice',
      clientLastname: 'Martin',
      clientEmail: 'alice@example.test',
      skin: 'mate',
    },
  };
  beforeAll(async () => {
    process.env.JWT_SECRET = 'booking-links-http-test-secret';
    const module = await Test.createTestingModule({
      imports: [
        PassportModule,
        JwtModule.register({ secret: process.env.JWT_SECRET }),
      ],
      controllers: [BookingLinksController, AppointmentsController],
      providers: [
        JwtStrategy,
        { provide: BookingLinksService, useValue: links },
        { provide: AppointmentsService, useValue: appointments },
      ],
    })
      .overrideGuard(SecurityThrottleGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(SaasLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    jwt = module.get(JwtService);
    await app.init();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    links.list.mockResolvedValue({
      data: [],
      page: 1,
      limit: 20,
      hasMore: false,
    });
    links.confirm.mockResolvedValue({ status: 'USED' });
  });
  afterAll(async () => {
    await app.close();
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  });
  const auth = (role: string, userId = 'actor') =>
    `Bearer ${jwt.sign({ userId, role })}`;
  const confirm = (value: object = body) =>
    request(app.getHttpServer())
      .post(`/appointments/booking-links/public/${token}/confirm`)
      .send(value);

  it('does not route the static booking-links list to appointments/:id', async () => {
    await request(app.getHttpServer())
      .get('/appointments/booking-links')
      .set('Authorization', auth('user_salon'))
      .expect(200);
    expect(links.list).toHaveBeenCalledWith(
      'actor',
      expect.objectContaining({ page: 1, limit: 20 }),
    );
    expect(appointments.getOneAppointment).not.toHaveBeenCalled();
  });
  it('requires authentication for professional mutations', async () => {
    await request(app.getHttpServer())
      .post('/appointments/booking-links')
      .send({})
      .expect(401);
    await request(app.getHttpServer())
      .patch('/appointments/booking-links/revoke/id')
      .expect(401);
  });
  it('allows a guest with no credentials without claiming an identity', async () => {
    await confirm().expect(201);
    expect(links.confirm).toHaveBeenCalledWith(
      token,
      expect.objectContaining(body),
      undefined,
    );
  });
  it('passes only the verified principal and strips caller-supplied account IDs', async () => {
    await confirm({
      ...body,
      clientUserId: 'victim',
      rdvBody: { ...body.rdvBody, clientId: 'victim', durationMinutes: 1 },
    })
      .set('Authorization', auth('client', 'real-client'))
      .expect(201);
    const actual = links.confirm.mock.calls[0];
    expect(actual[2]).toBe('real-client');
    expect(actual[1]).not.toHaveProperty('clientUserId');
    expect(actual[1].rdvBody).not.toHaveProperty('clientId');
    expect(actual[1].rdvBody).not.toHaveProperty('durationMinutes');
  });
  it.each(['user_salon', 'user_tatoueur', 'admin'])(
    'rejects %s as a booking client',
    async (role) => {
      await confirm().set('Authorization', auth(role)).expect(403);
      expect(links.confirm).not.toHaveBeenCalled();
    },
  );
  it('rejects invalid credentials rather than treating them as a guest', async () => {
    await confirm().set('Authorization', 'Bearer invalid').expect(401);
    expect(links.confirm).not.toHaveBeenCalled();
  });
  it.each([
    { ...body, start: '2030-01-07T09:00:00' },
    { ...body, rdvBody: undefined },
    { ...body, rdvBody: { ...body.rdvBody, skin: 'unknown' } },
  ])('rejects invalid confirmation DTO %j', async (value) => {
    await confirm(value).expect(400);
  });
  it('rejects out-of-range custom durations before invoking the service', async () => {
    await request(app.getHttpServer())
      .post('/appointments/booking-links')
      .set('Authorization', auth('user_salon'))
      .send({
        prestation: 'TATTOO',
        durationMinutes: 0,
        mode: 'AUTOMATIC',
        allowedFrom: '2030-01-01',
        allowedTo: '2030-01-02',
      })
      .expect(400);
    expect(links.create).not.toHaveBeenCalled();
  });
  it('accepts a period-only professional update without appointment time fields', async () => {
    await request(app.getHttpServer())
      .patch('/appointments/desired-tattoo-period/project')
      .set('Authorization', auth('user_salon'))
      .send({ desiredTattooPeriod: 'ASAP' })
      .expect(200);
    expect(appointments.updateDesiredTattooPeriod).toHaveBeenCalledWith(
      'project',
      'actor',
      expect.objectContaining({ desiredTattooPeriod: 'ASAP' }),
    );
  });
});
