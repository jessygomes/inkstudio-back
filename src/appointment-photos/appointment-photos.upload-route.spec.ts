import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { SecurityThrottleGuard } from 'src/auth/security-throttle';
import { AppointmentPhotoUploadService } from './appointment-photo-upload.service';
import { AppointmentPhotosController } from './appointment-photos.controller';
import { AppointmentPhotosService } from './appointment-photos.service';

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);

// Vérifie le câblage HTTP de la route d'envoi (multipart, champ « photos », limites, en-tête Authorization),
// sans base de données ni UploadThing : le service d'envoi est simulé.
describe('POST /appointments/:id/photos/upload', () => {
  let app: INestApplication;
  const uploads = { upload: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AppointmentPhotosController],
      providers: [
        { provide: AppointmentPhotosService, useValue: {} },
        { provide: AppointmentPhotoUploadService, useValue: uploads },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest().user = { userId: 'artist' };
          return true;
        },
      })
      .overrideGuard(SecurityThrottleGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());
  beforeEach(() => uploads.upload.mockReset().mockResolvedValue([{ id: 'p1', url: 'https://utfs.io/f/a' }]));

  it('passes the files, the user and the bearer token to the upload service', async () => {
    const res = await request(app.getHttpServer())
      .post('/appointments/rdv-1/photos/upload')
      .set('Authorization', 'Bearer abc')
      .attach('photos', jpeg, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .attach('photos', jpeg, { filename: 'b.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual([{ id: 'p1', url: 'https://utfs.io/f/a' }]);
    const [id, userId, files, authorization] = uploads.upload.mock.calls[0];
    expect([id, userId, authorization]).toEqual(['rdv-1', 'artist', 'Bearer abc']);
    expect(files).toHaveLength(2);
    expect(files[0].buffer.equals(jpeg)).toBe(true);
  });

  it('hands an empty list to the service when no file is attached (it answers 400)', async () => {
    await request(app.getHttpServer()).post('/appointments/rdv-1/photos/upload').set('Authorization', 'Bearer abc');
    expect(uploads.upload.mock.calls[0][2]).toEqual([]);
  });

  it('rejects more than five files at the multipart layer', async () => {
    let req = request(app.getHttpServer()).post('/appointments/rdv-1/photos/upload').set('Authorization', 'Bearer abc');
    for (let i = 0; i < 6; i++) req = req.attach('photos', jpeg, { filename: `${i}.jpg`, contentType: 'image/jpeg' });
    const res = await req;
    expect(res.status).toBe(400);
    expect(uploads.upload).not.toHaveBeenCalled();
  });

  it('rejects a file over 8 MB at the multipart layer', async () => {
    const res = await request(app.getHttpServer())
      .post('/appointments/rdv-1/photos/upload')
      .set('Authorization', 'Bearer abc')
      .attach('photos', Buffer.alloc(8 * 1024 * 1024 + 1024, 1), { filename: 'big.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(413);
    expect(uploads.upload).not.toHaveBeenCalled();
  });
});
