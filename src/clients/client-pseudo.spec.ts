import { BadRequestException, ConflictException } from '@nestjs/common';
import { assertPseudoAvailable, checkPseudo, generateUniquePseudo, isPseudoUniqueViolation, pseudoFormatError } from './client-pseudo';

describe('client pseudo', () => {
  const db = (taken: string[] = []) => ({
    clientProfile: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(taken.some((p) => p.toLowerCase() === String(where.pseudo.equals).toLowerCase()) ? { id: 'x' } : null)),
    },
  }) as any;

  it('validates the format', () => {
    expect(pseudoFormatError('')).toBe('Choisissez un pseudo.');
    expect(pseudoFormatError('ab')).toMatch(/au moins 3/);
    expect(pseudoFormatError('a'.repeat(31))).toMatch(/30/);
    expect(pseudoFormatError('ink fan')).toMatch(/sans espace/);
    expect(pseudoFormatError('Benoît_42.ink-fan')).toBeNull();
  });

  it('treats pseudos case-insensitively and trims them', async () => {
    const prisma = db(['InkFan']);
    await expect(checkPseudo(prisma, ' inkfan ')).resolves.toMatchObject({ available: false, code: 'PSEUDO_TAKEN' });
    await expect(checkPseudo(prisma, 'inkfan2')).resolves.toEqual({ available: true });
    await expect(checkPseudo(prisma, 'a b')).resolves.toMatchObject({ available: false, code: 'PSEUDO_INVALID' });
    expect(prisma.clientProfile.findFirst.mock.calls[0][0].where.pseudo).toEqual({ equals: 'inkfan', mode: 'insensitive' });
  });

  it('lets a user keep their own pseudo', async () => {
    const prisma = db();
    await assertPseudoAvailable(prisma, 'inkfan', 'me');
    expect(prisma.clientProfile.findFirst.mock.calls[0][0].where.userId).toEqual({ not: 'me' });
  });

  it('refuses taken or invalid pseudos at save time', async () => {
    await expect(assertPseudoAvailable(db(['inkfan']), 'INKFAN')).rejects.toBeInstanceOf(ConflictException);
    await expect(assertPseudoAvailable(db(), 'x')).rejects.toBeInstanceOf(BadRequestException);
    await expect(assertPseudoAvailable(db(), '  Inkfan  ')).resolves.toBe('Inkfan');
  });

  it('generates a free valid pseudo from the first name', async () => {
    const pseudo = await generateUniquePseudo(db(), 'Benoît');
    expect(pseudo).toMatch(/^benoit\d{4}$/);
    expect(pseudoFormatError(pseudo)).toBeNull();
    expect(await generateUniquePseudo(db(), null)).toMatch(/^client\d{4}$/);
  });

  it('detects the database unique violation', () => {
    expect(isPseudoUniqueViolation({ message: 'duplicate key value violates unique constraint "ClientProfile_pseudo_lower_key"' })).toBe(true);
    expect(isPseudoUniqueViolation({ code: 'P2002', meta: { target: ['email'] } })).toBe(false);
  });
});
