import { findAccountImagesByEmail } from './client-account-images';

describe('findAccountImagesByEmail', () => {
  it('renvoie les photos par e-mail en minuscules, en une requête pour moins de 50 e-mails', async () => {
    const prisma = { user: { findMany: jest.fn().mockResolvedValue([{ email: 'Henry@Gmail.com', image: 'https://img/h.webp' }, { email: 'vide@x.fr', image: '  ' }]) } };
    const map = await findAccountImagesByEmail(prisma as never, ['henry@gmail.com', ' HENRY@gmail.com ', 'vide@x.fr', null, undefined, '']);
    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ role: 'client', OR: [{ email: { equals: 'henry@gmail.com', mode: 'insensitive' } }, { email: { equals: 'vide@x.fr', mode: 'insensitive' } }] }),
    }));
    expect([...map.entries()]).toEqual([['henry@gmail.com', 'https://img/h.webp']]);
  });

  it("ne fait aucune requête sans e-mail", async () => {
    const prisma = { user: { findMany: jest.fn() } };
    expect((await findAccountImagesByEmail(prisma as never, [null, '  '])).size).toBe(0);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('découpe par lots de 50 e-mails', async () => {
    const prisma = { user: { findMany: jest.fn().mockResolvedValue([]) } };
    await findAccountImagesByEmail(prisma as never, Array.from({ length: 120 }, (_, i) => `c${i}@x.fr`));
    expect(prisma.user.findMany).toHaveBeenCalledTimes(3);
  });
});
