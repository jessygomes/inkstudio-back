import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppointmentPhotoUploadService } from 'src/appointment-photos/appointment-photo-upload.service';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { SecurityThrottleGuard } from 'src/auth/security-throttle';
import { ConversationAccessGuard } from '../conversations/guards/conversation-access.guard';
import { MessageAccessGuard } from './guards/message-access.guard';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);

// Câblage HTTP de l'envoi d'images pour les messages (multipart, champ « files »), sans base ni UploadThing.
describe('POST /messaging/conversations/:id/attachments/upload', () => {
  let app: INestApplication;
  const uploads = { storeImages: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MessagesController],
      providers: [
        { provide: MessagesService, useValue: {} },
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
      .overrideGuard(ConversationAccessGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(MessageAccessGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(SecurityThrottleGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());
  beforeEach(() =>
    uploads.storeImages.mockReset().mockResolvedValue([
      { key: 'k1', url: 'https://utfs.io/f/k1', size: 68, type: 'image/jpeg', name: 'photo-1.jpg' },
    ]),
  );

  it('returns the attachments to join to the message, restricted to web-safe formats', async () => {
    const res = await request(app.getHttpServer())
      .post('/messaging/conversations/conv-1/attachments/upload')
      .set('Authorization', 'Bearer abc')
      .attach('files', jpeg, { filename: 'a.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual([
      { fileName: 'photo-1.jpg', fileUrl: 'https://utfs.io/f/k1', fileType: 'image/jpeg', fileSize: 68, uploadThingKey: 'k1' },
    ]);
    const [userId, files, authorization, kinds] = uploads.storeImages.mock.calls[0];
    expect([userId, authorization]).toEqual(['artist', 'Bearer abc']);
    expect(files).toHaveLength(1);
    expect(kinds).toEqual(['jpeg', 'png', 'webp', 'gif']);
  });

  it('rejects more than five files at the multipart layer', async () => {
    let req = request(app.getHttpServer()).post('/messaging/conversations/conv-1/attachments/upload').set('Authorization', 'Bearer abc');
    for (let i = 0; i < 6; i++) req = req.attach('files', jpeg, { filename: `${i}.jpg`, contentType: 'image/jpeg' });
    const res = await req;
    expect(res.status).toBe(400);
    expect(uploads.storeImages).not.toHaveBeenCalled();
  });
});
