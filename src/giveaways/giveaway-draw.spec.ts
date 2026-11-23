import { drawWithoutReplacement, newDrawSeed, runDraw, SeededUniform, snapshotHash } from './giveaway-draw';

const seed = 'a'.repeat(64);
const snapshot = (n: number) => ({
  giveawayId: 'g',
  categoryId: 'c',
  entries: Array.from({ length: n }, (_, i) => ({ entryId: `e${String(i).padStart(3, '0')}`, participantHash: `h${i}` })),
});

describe('giveaway draw', () => {
  it('never uses Math.random', () => {
    const spy = jest.spyOn(Math, 'random');
    runDraw(snapshot(50), 3, 3, newDrawSeed());
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('picks distinct winners then distinct alternates (no replacement)', () => {
    for (let i = 0; i < 200; i++) {
      const r = runDraw(snapshot(10), 3, 3, newDrawSeed());
      const all = [...r.winners, ...r.alternates].map((e) => e.entryId);
      expect(r.winners).toHaveLength(3);
      expect(r.alternates).toHaveLength(3);
      expect(new Set(all).size).toBe(6);
    }
  });

  it('is reproducible from the seed and the frozen list', () => {
    const a = runDraw(snapshot(30), 3, 3, seed);
    const b = runDraw(snapshot(30), 3, 3, seed);
    expect(a).toEqual(b);
    expect(snapshotHash(snapshot(30))).toBe(snapshotHash(snapshot(30)));
    expect(snapshotHash(snapshot(30))).not.toBe(snapshotHash(snapshot(31)));
  });

  it('handles fewer candidates than prizes (shortfall) and empty lists', () => {
    expect(runDraw(snapshot(2), 3, 3, seed)).toMatchObject({ shortfall: 1, alternates: [] });
    expect(runDraw(snapshot(2), 3, 3, seed).winners).toHaveLength(2);
    expect(runDraw(snapshot(4), 3, 3, seed).alternates).toHaveLength(1);
    expect(runDraw(snapshot(0), 1, 3, seed)).toEqual({ winners: [], alternates: [], shortfall: 1 });
  });

  it('is unbiased (chi-square on first pick, 7 candidates)', () => {
    const counts = new Array(7).fill(0);
    const items = [0, 1, 2, 3, 4, 5, 6];
    const N = 14000;
    for (let i = 0; i < N; i++) counts[drawWithoutReplacement(items, 1, newDrawSeed())[0]]++;
    const expected = N / 7;
    const chi2 = counts.reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
    expect(chi2).toBeLessThan(22.46); // p = 0,001 pour 6 degrés de liberté
  });

  it('rejection sampling stays in range and rejects bad bounds/seeds', () => {
    const rng = new SeededUniform(Buffer.from(seed, 'hex'));
    for (let i = 0; i < 1000; i++) {
      const v = rng.int(3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(3);
    }
    expect(() => rng.int(0)).toThrow();
    expect(() => drawWithoutReplacement([1], 1, 'short')).toThrow();
  });
});
