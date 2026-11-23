/**
 * Initialise le concours Inkera 2026–2027 en BROUILLON (idempotent).
 *
 *   npm run giveaway:seed-inkera-2026-2027 -- --admin <adminUserId> [--dry-run]
 *
 * - Ne crée rien si le slug existe déjà (aucune modification d'un concours existant).
 * - Ne publie pas le concours, ne valide pas le règlement, n'envoie aucun e-mail,
 *   n'appelle pas Stripe.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { categoryCreateData, readConfig, rulesHash, validateDefinition } from '../src/giveaways/giveaway-definition';
import { inkera20262027Definition } from '../src/giveaways/inkera-2026-2027';

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const adminId = arg('--admin');
  const def = inkera20262027Definition();
  validateDefinition(def);

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.giveaway.findUnique({ where: { slug: def.slug }, select: { id: true, status: true } });
    if (existing) {
      console.log(JSON.stringify({ result: 'already-exists', id: existing.id, status: existing.status }));
      return;
    }
    if (!adminId) throw new Error('Indiquez --admin <id> (compte admin auteur du brouillon).');
    const admin = await prisma.user.findUnique({ where: { id: adminId }, select: { role: true } });
    if (admin?.role !== 'admin') throw new Error('--admin doit désigner un compte admin.');
    if (dryRun) {
      console.log(JSON.stringify({ result: 'dry-run', slug: def.slug, opensAt: def.opensAt, closesAt: def.closesAt, drawAt: def.drawAt }));
      return;
    }
    try {
      const created = await prisma.$transaction(async (tx) => {
        const g = await tx.giveaway.create({
          data: {
            slug: def.slug,
            title: def.title,
            description: def.description,
            opensAt: def.opensAt,
            closesAt: def.closesAt,
            drawAt: def.drawAt,
            timezone: def.timezone,
            rulesContent: def.rulesContent,
            rulesHash: rulesHash(def.rulesContent, null),
            config: readConfig(def.config as Prisma.JsonValue),
            createdById: adminId,
          },
        });
        for (const c of categoryCreateData(def.categories, g.id)) {
          const { prizes, ...category } = c;
          await tx.giveawayCategory.create({ data: { ...category, giveawayId: g.id, prizes: { create: prizes.map((p) => ({ ...p, giveawayId: g.id })) } } });
        }
        await tx.giveawayAuditLog.create({ data: { giveawayId: g.id, actorId: adminId, action: 'giveaway.created', data: { slug: def.slug, source: 'seed-script' } } });
        return g;
      });
      console.log(JSON.stringify({ result: 'created', id: created.id, status: created.status }));
    } catch (error) {
      // Exécution concurrente : l'autre exécution a créé le concours.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        console.log(JSON.stringify({ result: 'already-exists' }));
        return;
      }
      throw error;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
