import { ForbiddenException } from '@nestjs/common';
import { FollowupsController } from './follow-up.controller';

describe('Réponse du salon à un suivi de cicatrisation', () => {
  const appointment = {
    id: 'appointment',
    clientId: 'client',
    clientUserId: 'people-user',
    prestation: 'TATTOO',
    client: { email: 'benoit@mail.test', firstName: 'Benoît', lastName: 'Martin', linkedUserId: 'people-user' },
    tatoueur: { name: 'Luna' },
    user: { salonName: 'Atelier Luna' },
  };
  let prisma: any;
  let mail: { sendFollowUpResponse: jest.Mock };
  let reminders: { postToClientConversation: jest.Mock };
  let controller: FollowupsController;
  const auth = (userId = 'salon') => ({ user: { userId } }) as any;

  beforeEach(() => {
    prisma = {
      followUpSubmission: {
        findUnique: jest.fn().mockResolvedValue({ id: 'sub', userId: 'salon', isAnswered: false, appointment }),
        update: jest.fn(async ({ data }) => ({ id: 'sub', ...data })),
      },
    };
    mail = { sendFollowUpResponse: jest.fn().mockResolvedValue({}) };
    reminders = { postToClientConversation: jest.fn().mockResolvedValue(true) };
    controller = new FollowupsController(prisma, mail as any, undefined, reminders as any);
  });

  it("répond par e-mail par défaut, sans passer par la messagerie, et enregistre la date et le canal", async () => {
    const result = await controller.replyToFollowUp(auth(), 'sub', { reply: '  Tout est normal, continuez la crème.  ' });
    expect(prisma.followUpSubmission.update).toHaveBeenCalledWith({
      where: { id: 'sub' },
      data: expect.objectContaining({ response: 'Tout est normal, continuez la crème.', isAnswered: true, responseChannels: 'EMAIL', respondedAt: expect.any(Date) }),
    });
    expect(mail.sendFollowUpResponse).toHaveBeenCalledWith('benoit@mail.test', expect.anything(), 'Atelier Luna');
    expect(reminders.postToClientConversation).not.toHaveBeenCalled();
    expect(result.inkeraSent).toBe(false);
  });

  it('envoie aussi la réponse dans la conversation Inkera du client quand c’est demandé', async () => {
    const result = await controller.replyToFollowUp(auth(), 'sub', { reply: 'Passez nous voir.', channel: 'EMAIL_AND_INKERA' });
    expect(reminders.postToClientConversation).toHaveBeenCalledWith(appointment, 'salon', expect.stringContaining('Passez nous voir.'));
    expect(mail.sendFollowUpResponse).toHaveBeenCalled();
    expect(result.inkeraSent).toBe(true);
  });

  it('signale quand le client n’a pas de conversation Inkera (e-mail seulement)', async () => {
    reminders.postToClientConversation.mockResolvedValue(false);
    const result = await controller.replyToFollowUp(auth(), 'sub', { reply: 'Ok', channel: 'EMAIL_AND_INKERA' });
    expect(result.inkeraSent).toBe(false);
    expect(mail.sendFollowUpResponse).toHaveBeenCalled();
  });

  it("refuse de répondre au suivi d'un autre salon", async () => {
    await expect(controller.replyToFollowUp(auth('autre'), 'sub', { reply: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.followUpSubmission.update).not.toHaveBeenCalled();
  });
});
