import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';

export function emailTokenHash(
  purpose: 'verify' | 'reset',
  token: string,
): string {
  return `sha256:${createHash('sha256').update(`inkera:${purpose}:${token}`).digest('hex')}`;
}
export function validateEmailToken(
  email: unknown,
  token: unknown,
): asserts email is string {
  if (
    typeof email !== 'string' ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    typeof token !== 'string' ||
    !/^[a-f0-9]{64}$/.test(token)
  )
    throw new BadRequestException('Lien invalide ou expiré.');
}
