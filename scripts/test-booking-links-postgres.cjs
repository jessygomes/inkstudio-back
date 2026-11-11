// Starts an isolated, loopback-only PostgreSQL cluster; never uses DATABASE_URL from .env.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const root = path.resolve(__dirname, '..');
const bin =
  process.env.PG_BIN ||
  (process.platform === 'win32'
    ? 'C:/Program Files/PostgreSQL/16/bin'
    : '/usr/bin');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'inkera-booking-pg-'));
const cluster = path.join(scratch, 'data');
const executable = (name) =>
  path.join(bin, name + (process.platform === 'win32' ? '.exe' : ''));
let env = { ...process.env, INKERA_PEOPLE_BASE_URL: 'https://theinkera.com' };
function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    windowsHide: true,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  });
  if (result.status !== 0)
    throw new Error(
      `${path.basename(command)} failed: ${result.error || result.stderr || result.status}`,
    );
  return result.stdout;
}
async function main() {
  const port = await new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
  const url = `postgresql://postgres@127.0.0.1:${port}/inkera_booking_test`;
  env = { ...env, DATABASE_URL: url, BOOKING_LINK_TEST_DATABASE_URL: url };
  let started = false;
  try {
    run(executable('initdb'), [
      '-D',
      cluster,
      '-U',
      'postgres',
      '-A',
      'trust',
      '--no-locale',
      '-E',
      'UTF8',
    ]);
    run(executable('pg_ctl'), [
      '-D',
      cluster,
      '-l',
      path.join(scratch, 'postgres.log'),
      '-o',
      `-h 127.0.0.1 -p ${port}`,
      '-w',
      'start',
    ]);
    started = true;
    run(executable('createdb'), [
      '-h',
      '127.0.0.1',
      '-p',
      String(port),
      '-U',
      'postgres',
      'inkera_booking_test',
    ]);
    const prisma = path.join(root, 'node_modules/prisma/build/index.js');
    // Reconstruct the immediate pre-feature schema to exercise the incremental SQL migration.
    let baseline = fs.readFileSync(
      path.join(root, 'prisma/schema.prisma'),
      'utf8',
    );
    baseline = baseline.replace(
      /\n(?:model BookingLink|enum DesiredTattooPeriod|enum BookingLinkMode|enum BookingLinkStatus) \{[^}]*\}/g,
      '',
    );
    baseline = baseline
      .split(/\r?\n/)
      .filter(
        (line) =>
          !/\bBookingLink\[?/.test(line) &&
          !/^\s+desiredTattoo(?:Period|Date|StartDate|EndDate)\s/.test(line),
      )
      .join('\n');
    const schema = path.join(scratch, 'before.prisma');
    fs.writeFileSync(schema, baseline);
    run(process.execPath, [
      prisma,
      'db',
      'push',
      '--schema',
      schema,
      '--skip-generate',
    ]);
    // A legacy row must survive the additive migration unchanged.
    const seed = path.join(scratch, 'legacy.sql');
    fs.writeFileSync(
      seed,
      `INSERT INTO "User" (id,email,password,"salonPhotos",prestations,style,"updatedAt") VALUES ('legacy-salon','legacy@example.test','test', '{}','{}','{}',NOW());\nINSERT INTO "Appointment" (id,title,prestation,start,"end","userId","updatedAt") VALUES ('legacy-rdv','Legacy','PROJET',NOW(),NOW()+interval '1 hour','legacy-salon',NOW());`,
    );
    const psql = (args) =>
      run(executable('psql'), [
        '-h',
        '127.0.0.1',
        '-p',
        String(port),
        '-U',
        'postgres',
        '-d',
        'inkera_booking_test',
        '-v',
        'ON_ERROR_STOP=1',
        ...args,
      ]);
    psql(['-f', seed]);
    psql([
      '-f',
      path.join(
        root,
        'prisma/migrations/20261111090000_personal_booking_links/migration.sql',
      ),
    ]);
    psql([
      '-c',
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM "Appointment" WHERE id='legacy-rdv' AND "desiredTattooPeriod" IS NULL) THEN RAISE EXCEPTION 'Legacy row changed'; END IF; END $$;`,
    ]);
    run(process.execPath, [
      path.join(root, 'node_modules/jest/bin/jest.js'),
      '--runInBand',
      '--testPathPattern=booking-links.postgres.spec.ts',
    ]);
  } finally {
    if (started)
      run(executable('pg_ctl'), ['-D', cluster, '-m', 'fast', '-w', 'stop']);
    console.log(`Isolated PostgreSQL artifacts: ${scratch}`);
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
