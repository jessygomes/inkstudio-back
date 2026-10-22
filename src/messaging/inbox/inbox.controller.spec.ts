import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';

describe('InboxController — API protégée et identification du compte', () => {
  const inbox = {
    listThreads: jest.fn(), getThread: jest.fn(), sendReply: jest.fn(),
    assignThread: jest.fn(), linkClient: jest.fn(), listSavedReplies: jest.fn(),
  };
  const controller = new InboxController(inbox as unknown as InboxService);
  const request = { user: { userId: 'salon-a', role: 'user_salon' } } as any;

  beforeEach(() => jest.clearAllMocks());

  it('expose les routes sous /messaging/inbox et impose un JWT', () => {
    expect(Reflect.getMetadata(PATH_METADATA, InboxController)).toBe('messaging/inbox');
    const guards = Reflect.getMetadata(GUARDS_METADATA, InboxController) as Function[];
    expect(guards).toContain(JwtAuthGuard);
  });

  it('liste dans le périmètre du JWT et non d’un propriétaire fourni par le client', async () => {
    inbox.listThreads.mockResolvedValue({ data: [], total: 0 });
    await controller.listThreads(request, { channel: 'INKERA' } as any);
    expect(inbox.listThreads).toHaveBeenCalledWith('salon-a', { channel: 'INKERA' });
  });

  it('les affectations, lectures et réponses utilisent toujours le compte authentifié', async () => {
    await controller.getThread(request, 'thread-a');
    await controller.assignThread(request, 'thread-a', { assignedUserId: 'artist-a' });
    await controller.sendReply(request, 'thread-a', { content: 'Bonjour' });
    expect(inbox.getThread).toHaveBeenCalledWith('salon-a', 'thread-a');
    expect(inbox.assignThread).toHaveBeenCalledWith('salon-a', 'thread-a', { assignedUserId: 'artist-a' });
    expect(inbox.sendReply).toHaveBeenCalledWith('salon-a', 'thread-a', { content: 'Bonjour' });
  });
});
