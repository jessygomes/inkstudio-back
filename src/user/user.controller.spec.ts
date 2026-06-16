 
import { Test, TestingModule } from '@nestjs/testing';
import { UserController } from './user.controller';
import { UserService } from './user.service';

describe('UserController', () => {
  let controller: UserController;
  let service: UserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        {
          provide: UserService,
          useValue: {
            getUsers: jest.fn(),
            getUserProfile: jest.fn(),
            updateUserProfile: jest.fn(),
            deleteUser: jest.fn(),
            toggleInspirationSalon: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<UserController>(UserController);
    service = module.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should toggle inspiration salon through the service', async () => {
    const req = {
      user: {
        userId: 'user-1',
        role: 'user_salon',
      },
    } as never;

    service.toggleInspirationSalon = jest.fn().mockResolvedValue({
      error: false,
      message: 'ok',
    }) as never;

    const result = await controller.toggleInspirationSalon(req);

    expect(service.toggleInspirationSalon).toHaveBeenCalledWith({
      userId: 'user-1',
      role: 'user_salon',
    });
    expect(result).toEqual({ error: false, message: 'ok' });
  });
});
