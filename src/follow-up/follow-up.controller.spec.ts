import { Test, TestingModule } from '@nestjs/testing';
import { FollowupsController } from './follow-up.controller';
import { PrismaService } from 'src/database/prisma.service';
import { MailService } from 'src/email/mailer.service';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

describe('FollowupsController', () => {
  let controller: FollowupsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FollowupsController],
      providers: [
        {
          provide: PrismaService,
          useValue: {
            followUpRequest: {
              findUnique: jest.fn(),
              update: jest.fn(),
            },
            followUpSubmission: {
              create: jest.fn(),
              findMany: jest.fn(),
              count: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            $transaction: jest.fn(),
          },
        },
        {
          provide: MailService,
          useValue: {
            sendFollowUpResponse: jest.fn(),
          },
        },
        {
          provide: JwtAuthGuard,
          useValue: { canActivate: jest.fn().mockReturnValue(true) },
        },
      ],
    }).compile();

    controller = module.get<FollowupsController>(FollowupsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
