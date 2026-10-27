import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createCityMatcher, validateCommunes } from './lib/city-audit';

async function run() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log(
      'Audit en lecture seule : npm run audit:cities -- --communes=CHEMIN [--output=CHEMIN]',
    );
    return;
  }
  const options: Record<string, string> = {};
  for (const arg of args) {
    const match = /^--(communes|output)=(.+)$/.exec(arg);
    if (!match || options[match[1]])
      throw new Error(`Option invalide ou dupliquée : ${arg}`);
    options[match[1]] = match[2];
  }
  if (!options.communes)
    throw new Error(
      'Indiquez --communes=CHEMIN vers le communes-france.json utilisé par le frontend.',
    );
  const source = await readFile(resolve(options.communes));
  const communes: unknown = JSON.parse(
    source.toString('utf8').replace(/^\uFEFF/, ''),
  );
  validateCommunes(communes);
  const matchCity = createCityMatcher(communes);
  const createdAt = new Date().toISOString();
  const output = resolve(
    options.output ??
      `reports/cities/audit-${createdAt.replace(/[:.]/g, '-')}.json`,
  );
  // Reserve the output before connecting; never overwrite a previous audit.
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ state: 'running', createdAt }), {
    flag: 'wx',
    mode: 0o600,
  });
  const prisma = new PrismaClient();
  try {
    // A consistent, read-only snapshot, including the separate client locations.
    const [users, clients] = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        return Promise.all([
          tx.user.findMany({
            select: {
              id: true,
              role: true,
              city: true,
              postalCode: true,
              updatedAt: true,
            },
            orderBy: { id: 'asc' },
          }),
          tx.clientProfile.findMany({
            select: {
              id: true,
              userId: true,
              city: true,
              postalCode: true,
              updatedAt: true,
            },
            orderBy: { id: 'asc' },
          }),
        ]);
      },
      { isolationLevel: 'RepeatableRead', timeout: 60000 },
    );
    const records = [
      ...users.map(({ city, postalCode, ...user }) => ({
        model: 'User',
        ...user,
        ...matchCity({ city, postalCode }),
        publicProfile: ['user', 'user_salon', 'user_tatoueur'].includes(
          user.role,
        ),
      })),
      ...clients.map(({ city, postalCode, ...client }) => ({
        model: 'ClientProfile',
        ...client,
        ...matchCity({ city, postalCode }),
        publicProfile: false,
      })),
    ];
    const summary = Object.fromEntries(
      ['User', 'ClientProfile'].map((model) => {
        const rows = records.filter((row) => row.model === model);
        return [
          model,
          {
            total: rows.length,
            ...Object.fromEntries(
              ['conform', 'correctable', 'review', 'missing'].map((status) => [
                status,
                rows.filter((row) => row.status === status).length,
              ]),
            ),
            publicLocationSlugChanges: rows.filter(
              (row) => row.publicProfile && row.slugChanged,
            ).length,
          },
        ];
      }),
    );
    await writeFile(
      output,
      JSON.stringify(
        {
          state: 'complete',
          mode: 'read-only',
          createdAt,
          reference: {
            path: resolve(options.communes),
            sha256: createHash('sha256').update(source).digest('hex'),
            count: communes.length,
          },
          summary,
          records,
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify(summary, null, 2));
    console.log(`Rapport enregistré : ${output}. Aucune donnée modifiée.`);
  } catch (error) {
    await writeFile(
      output,
      JSON.stringify(
        { state: 'failed', createdAt, mode: 'read-only' },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

run().catch((error: unknown) => {
  // Prisma errors may contain connection details. Do not print them to shared logs.
  const code =
    error && typeof error === 'object'
      ? 'code' in error
        ? error.code
        : 'errorCode' in error
          ? error.errorCode
          : null
      : null;
  const safeCode =
    typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? ` (${code})` : '';
  const safeName =
    error instanceof Error && /^[A-Za-z]+$/.test(error.name)
      ? error.name
      : 'Error';
  console.error(`Type : ${safeName}${safeCode}`);
  console.error(
    `Audit interrompu${safeCode} : vérifiez les options, le référentiel, le chemin de sortie et l'accès à DATABASE_URL. Seul un rapport avec state=complete est exploitable.`,
  );
  process.exitCode = 1;
});
