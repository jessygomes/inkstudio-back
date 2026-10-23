/* Fusionne les styles en doublon (orthographe proche). Simulation par défaut ; --apply pour écrire. */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

const styleKey = (v: string) =>
  v
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const levenshtein = (a: string, b: string) => {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = curr;
  }
  return prev[b.length];
};

// Doit rester identique à PortfolioService.typoTolerance
const tolerance = (key: string) => (key.length <= 4 ? 0 : key.length <= 8 ? 1 : 2);

async function main() {
  const photos = await prisma.portfolio.findMany({ select: { id: true, style: true } });

  const usage = new Map<string, number>();
  for (const p of photos) {
    for (const s of p.style) usage.set(s, (usage.get(s) ?? 0) + 1);
  }
  const registry = await prisma.style.findMany({ select: { id: true, name: true, key: true } });
  for (const s of registry) if (!usage.has(s.name)) usage.set(s.name, 0);

  // Les noms les plus utilisés deviennent canoniques
  const names = [...usage.keys()].sort((a, b) => usage.get(b)! - usage.get(a)! || a.localeCompare(b));
  const canonical: { name: string; key: string }[] = [];
  const mapping = new Map<string, string>();

  for (const name of names) {
    const key = styleKey(name);
    if (!key) continue;
    const match = canonical.find(
      (c) => c.key === key || (Math.abs(c.key.length - key.length) <= tolerance(key) && levenshtein(c.key, key) <= tolerance(key)),
    );
    if (match) mapping.set(name, match.name);
    else canonical.push({ name, key });
  }

  console.log(apply ? '== APPLY ==' : '== DRY RUN ==');
  console.log(`${names.length} styles distincts -> ${canonical.length} après fusion`);
  for (const [from, to] of mapping) console.log(`  ${from} (${usage.get(from)}) -> ${to} (${usage.get(to)})`);

  if (!apply || mapping.size === 0) return;

  let updated = 0;
  for (const p of photos) {
    const next = [...new Set(p.style.map((s) => mapping.get(s) ?? s))];
    if (next.length !== p.style.length || next.some((s, i) => s !== p.style[i])) {
      await prisma.portfolio.update({ where: { id: p.id }, data: { style: next } });
      updated++;
    }
  }

  const canonicalByKey = new Map(canonical.map((c) => [c.key, c.name]));
  for (const s of registry) {
    if (mapping.has(s.name) || canonicalByKey.get(s.key) !== s.name) {
      await prisma.style.delete({ where: { id: s.id } });
    }
  }
  for (const c of canonical) {
    await prisma.style.upsert({ where: { key: c.key }, update: { name: c.name }, create: { name: c.name, key: c.key } });
  }
  console.log(`${updated} photo(s) mise(s) à jour, registre synchronisé.`);
}

main().finally(() => prisma.$disconnect());
