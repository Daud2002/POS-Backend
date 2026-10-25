// A throwaway Postgres for tests and the migration generator.
//
// Plain ESM because embedded-postgres is ESM-only and Jest's module loader
// cannot require it; Jest loads .mjs globalSetup files natively, and ts-node
// scripts reach this through a dynamic import().
//
// Nothing here reads .env, so it can never point at the production database.
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Initialises and starts a fresh cluster in a temp folder on `port`, with one
 * empty database. `stop()` shuts it down and deletes the folder.
 *
 * UTF8 + C locale + UTC, matching what the store server installer sets up, so
 * a generated migration behaves the same on a shop PC.
 */
export async function startEmbeddedPostgres({ port, database = 'tapntrade' }) {
  const databaseDir = await mkdtemp(path.join(os.tmpdir(), 'tnt-pg-'));
  const pg = new EmbeddedPostgres({
    databaseDir,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    postgresFlags: ['-c', 'timezone=UTC'],
    onLog: () => {},
    onError: (error) => console.error('[embedded-postgres]', error),
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase(database);

  return {
    config: { host: '127.0.0.1', port, username: 'postgres', password: 'postgres', database },
    createDatabase: (name) => pg.createDatabase(name),
    stop: () => pg.stop(),
  };
}
