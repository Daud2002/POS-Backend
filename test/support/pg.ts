import { DataSource, DataSourceOptions } from 'typeorm';
import { ALL_ENTITIES } from '../../src/database/entities';
import { MIGRATIONS } from '../../src/database/migrations';

type Server = { host: string; port: number; username: string; password: string };

/** The ports test/global-setup.mjs starts. Nothing else is ever connected to. */
const HARNESS_PORTS = [54401, 54402];

/**
 * Connection settings for one of the harness clusters.
 *
 * The backend's .env points at production, so this never reads it, and it
 * throws on anything that is not a loopback harness port. A test that somehow
 * got other settings fails here instead of reaching a real database.
 */
export function harnessServer(which: 'cloud' | 'store'): Server {
  const raw = process.env[`TNT_TEST_PG_${which.toUpperCase()}`];
  if (!raw) throw new Error('Run through `npm run test:e2e` so the embedded Postgres is up.');
  const server = JSON.parse(raw) as Server;
  if (server.host !== '127.0.0.1' || !HARNESS_PORTS.includes(server.port)) {
    throw new Error(`Refusing to connect to ${server.host}:${server.port}: not a test harness database.`);
  }
  return server;
}

async function admin<T>(server: Server, run: (db: DataSource) => Promise<T>): Promise<T> {
  const db = new DataSource({ type: 'postgres', ...server, database: 'postgres' });
  await db.initialize();
  try {
    return await run(db);
  } finally {
    await db.destroy();
  }
}

/** DataSource options for an existing harness database. */
export function databaseOptions(which: 'cloud' | 'store', name: string): DataSourceOptions {
  return {
    type: 'postgres',
    ...harnessServer(which),
    database: name,
    entities: ALL_ENTITIES,
    migrations: MIGRATIONS,
    synchronize: false,
    logging: false,
  };
}

/** Drops and recreates `name`, and returns DataSource options for it. */
export async function freshDatabase(which: 'cloud' | 'store', name: string): Promise<DataSourceOptions> {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`Bad test database name: ${name}`);
  await admin(harnessServer(which), async (db) => {
    await db.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await db.query(`CREATE DATABASE "${name}"`);
  });
  return databaseOptions(which, name);
}

/** The DDL TypeORM would still run to make the database match the entities. */
export async function pendingSchemaChanges(dataSource: DataSource): Promise<string[]> {
  const { upQueries } = await dataSource.driver.createSchemaBuilder().log();
  return upQueries.map((q) => q.query);
}
