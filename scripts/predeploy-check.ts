import 'reflect-metadata';
// Nest loads .env through ConfigModule; a standalone script has to do it itself.
import * as dotenv from 'dotenv';
dotenv.config();

import { DataSource, QueryRunner } from 'typeorm';
import { typeormConfig } from '../src/database/typeorm.config';
import { ALL_ENTITIES } from '../src/database/entities';
import { MIGRATIONS } from '../src/database/migrations';

/**
 * Answers one question before merging to Main: will the deploy's migrations
 * run cleanly on the database in .env (production)?
 *
 *   npm run db:predeploy-check
 *
 * READ-ONLY. It never migrates, synchronizes or drops anything, whatever .env
 * says: it only reads the Postgres version, the list of migrations already
 * run, and the catalogue (the same reads `db:schema-diff` does). It then
 * compares what the database lacks with what the pending migrations add. If
 * they match exactly, the deploy will apply them cleanly; anything else is
 * drift, and the deploy must wait.
 */

type Captured = { name: string; statements: string[] };

const normalize = (sql: string) =>
  sql.replace(/\s+/g, ' ').replace(/DROP CONSTRAINT IF EXISTS/g, 'DROP CONSTRAINT').trim();

/** Runs a migration's up() against a fake runner that only records its SQL. */
async function statementsOf(migration: any): Promise<string[]> {
  const statements: string[] = [];
  const recorder = {
    query: async (sql: string) => {
      statements.push(sql);
      return [{ table: 'stores' }]; // the baseline's "already built?" check answers yes
    },
  } as unknown as QueryRunner;
  await new migration().up(recorder);
  return statements;
}

async function main() {
  const dataSource = new DataSource({
    ...(typeormConfig() as any),
    entities: ALL_ENTITIES,
    migrations: [],
    // Belt and braces: this script must never change anything.
    synchronize: false,
    migrationsRun: false,
    dropSchema: false,
    logging: false,
  });
  await dataSource.initialize();

  const problems: string[] = [];
  try {
    const target = `${process.env.DATABASE_HOST}/${process.env.DATABASE_NAME}`;
    console.log(`\nChecking ${target}\n`);

    // 1. Postgres new enough for the sync (xid8, pg_current_xact_id, gen_random_uuid).
    const [{ server_version_num, server_version }] = await dataSource.query(
      `SELECT current_setting('server_version_num')::int AS server_version_num, current_setting('server_version') AS server_version`,
    );
    if (server_version_num >= 130000) console.log(`✅ Postgres ${server_version} (13 or newer is needed)`);
    else problems.push(`Postgres ${server_version} is too old: the sync needs 13 or newer.`);

    // 2. The right database: an existing TapNtrade schema.
    const [{ stores }] = await dataSource.query(`SELECT to_regclass('public.stores') IS NOT NULL AS stores`);
    if (stores) console.log('✅ This is an existing TapNtrade database');
    else problems.push('There is no "stores" table here. Is .env pointing at the right database?');

    // 3. Which migrations have already run.
    const [{ has }] = await dataSource.query(`SELECT to_regclass('public.migrations') IS NOT NULL AS has`);
    const ran = new Set<string>(
      has ? (await dataSource.query(`SELECT name FROM migrations`)).map((r: { name: string }) => r.name) : [],
    );
    const pending = MIGRATIONS.filter((m: any) => !ran.has(new m().name));
    console.log(`✅ ${ran.size} migration(s) already run, ${pending.length} will run on deploy:`);
    for (const m of pending) console.log(`     - ${new (m as any)().name}`);

    // 4. What the database lacks must be exactly what the pending table migrations add.
    const captured: Captured[] = [];
    for (const m of pending as any[]) {
      const name = new m().name as string;
      // The baseline does nothing on an existing database; the sync migration
      // creates triggers and its own tables, which TypeORM does not track.
      if (name.startsWith('Baseline') || Array.isArray(m.triggers)) continue;
      captured.push({ name, statements: (await statementsOf(m)).map(normalize) });
    }
    const expected = new Set(captured.flatMap((c) => c.statements));
    const { upQueries } = await dataSource.driver.createSchemaBuilder().log();
    const actual = new Set(upQueries.map((q) => normalize(q.query)));

    const unexpected = [...actual].filter((s) => !expected.has(s));
    const alreadyThere = [...expected].filter((s) => !actual.has(s));
    if (!unexpected.length && !alreadyThere.length) {
      console.log(`✅ The database differs from the new code by exactly what the migrations add (${expected.size} change(s))`);
    }
    if (unexpected.length) {
      problems.push(
        `The database differs from the code in ways no migration covers (drift):\n${unexpected.map((s) => `     ${s}`).join('\n')}`,
      );
    }
    if (alreadyThere.length) {
      problems.push(
        `Some changes a migration would make are already in the database, so that migration would fail:\n${alreadyThere
          .map((s) => `     ${s}`)
          .join('\n')}`,
      );
    }

    // 5. The sync's own objects must not exist yet unless its migration already ran.
    const syncPending = pending.some((m: any) => Array.isArray(m.triggers));
    const [{ sync }] = await dataSource.query(`SELECT to_regclass('public.sync_meta') IS NOT NULL AS sync`);
    if (syncPending && sync) problems.push('sync_meta already exists, but its migration has not run. Something created it by hand.');
  } finally {
    await dataSource.destroy();
  }

  if (problems.length) {
    console.log('\n❌ NOT safe to merge yet:\n');
    problems.forEach((p) => console.log(`  • ${p}\n`));
    console.log('Abhi merge na karein. Yeh poora output Claude ko bhejein.\n');
    process.exitCode = 2;
  } else {
    console.log('\n✅ Safe to merge. Merge karna mehfooz hai.\n');
  }
}

main().catch((error) => {
  console.error('❌ The check could not run:', error?.message ?? error);
  console.error('Abhi merge na karein. Yeh output Claude ko bhejein.');
  process.exit(1);
});
