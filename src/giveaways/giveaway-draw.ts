import { createHash, randomBytes } from 'crypto';

/**
 * Tirage au sort vérifiable.
 *
 * - La graine (32 octets) vient de `crypto.randomBytes`, générée APRÈS que la
 *   liste des participants a été figée : personne ne peut la choisir.
 * - Les entiers sont dérivés de SHA-256(graine ‖ compteur) et ramenés à
 *   [0, n) par rejet (aucun biais de modulo).
 * - Sélection sans remise par Fisher–Yates partiel.
 * - Avec la graine et la liste figée (toutes deux conservées), n'importe qui
 *   peut rejouer le tirage et retrouver exactement le même résultat.
 */
export const DRAW_ALGORITHM = 'sha256-ctr+rejection+partial-fisher-yates/v1';

export function newDrawSeed(): string {
  return randomBytes(32).toString('hex');
}

export class SeededUniform {
  private counter = 0n;
  private buffer = Buffer.alloc(0);
  private offset = 0;

  constructor(private readonly seed: Buffer) {
    if (seed.length < 32) throw new Error('La graine doit faire au moins 32 octets.');
  }

  private nextUint32(): number {
    if (this.offset + 4 > this.buffer.length) {
      const counter = Buffer.alloc(8);
      counter.writeBigUInt64BE(this.counter++);
      this.buffer = createHash('sha256').update(this.seed).update(counter).digest();
      this.offset = 0;
    }
    const value = this.buffer.readUInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  /** Entier uniforme dans [0, maxExclusive). */
  int(maxExclusive: number): number {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > 2 ** 32)
      throw new Error('Borne invalide.');
    const range = 2 ** 32;
    const limit = range - (range % maxExclusive);
    for (;;) {
      const x = this.nextUint32();
      if (x < limit) return x % maxExclusive;
    }
  }
}

/** Ordonne `picks` éléments distincts de `items` (sans remise). `items` doit être trié de façon stable. */
export function drawWithoutReplacement<T>(items: readonly T[], picks: number, seedHex: string): T[] {
  if (!/^[0-9a-f]{64}$/.test(seedHex)) throw new Error('Graine invalide.');
  const n = items.length;
  const k = Math.min(Math.max(0, picks), n);
  const pool = [...items];
  const rng = new SeededUniform(Buffer.from(seedHex, 'hex'));
  for (let i = 0; i < k; i++) {
    const j = i + rng.int(n - i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, k);
}

export type DrawSnapshot = {
  giveawayId: string;
  categoryId: string;
  /** Participations éligibles figées, triées par id. */
  entries: { entryId: string; participantHash: string }[];
};

export function snapshotHash(snapshot: DrawSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

/** Gagnants puis suppléants, dans l'ordre du tirage. */
export function runDraw(
  snapshot: DrawSnapshot,
  winners: number,
  alternates: number,
  seedHex: string,
) {
  const ordered = drawWithoutReplacement(snapshot.entries, winners + alternates, seedHex);
  return {
    winners: ordered.slice(0, Math.min(winners, ordered.length)),
    alternates: ordered.slice(Math.min(winners, ordered.length)),
    shortfall: Math.max(0, winners - snapshot.entries.length),
  };
}
