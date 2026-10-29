import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

function storageKey(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      !(
        url.hostname === 'utfs.io' ||
        url.hostname.endsWith('.utfs.io') ||
        url.hostname.endsWith('.ufs.sh')
      )
    )
      return null;
    const match = /^\/f\/([a-zA-Z0-9_.-]{1,512})$/.exec(url.pathname);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Claim only known guest uploads. Legacy/external reference URLs retain their contract. */
export async function attachGuestUploads(
  tx: Prisma.TransactionClient,
  urls: (string | undefined | null)[],
  contextType: 'booking' | 'follow-up',
  contextIds: string[],
) {
  const keys = urls
    .map(storageKey)
    .filter((key): key is string => Boolean(key));
  if (!keys.length) return;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'upload-quota:guest-pool'}, 0))`;
  const rows = await tx.uploadReservation.findMany({
    where: { key: { in: keys }, ownerUserId: null },
  });
  if (
    rows.some(
      (row) =>
        row.status !== 'COMPLETE' ||
        row.contextType !== contextType ||
        !row.contextId ||
        !contextIds.includes(row.contextId),
    )
  )
    throw new ForbiddenException(
      'Photo indisponible pour cette demande. Transférez-la à nouveau.',
    );
  await tx.uploadReservation.updateMany({
    where: {
      id: { in: rows.map((row) => row.id) },
      status: 'COMPLETE',
      attachedAt: null,
    },
    data: { attachedAt: new Date() },
  });
}
