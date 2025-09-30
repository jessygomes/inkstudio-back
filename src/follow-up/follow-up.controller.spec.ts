import { Test, TestingModule } from '@nestjs/testing';
import { FollowupsController } from './follow-up.controller';

describe('FollowupsController', () => {
  let controller: FollowupsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FollowupsController],
    }).compile();

    controller = module.get<FollowupsController>(FollowupsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
