import { execFileSync } from 'child_process';
import { readFileSync, rmSync } from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { MIGRATIONS } from '../../src/database/migrations';
import { databaseOptions, freshDatabase, harnessServer } from '../support/pg';

/**
 * The two scripts run before merging to Main, against a database shaped like
 * production today: built by synchronize, no migrations table.
 */
describe('pre-deploy scripts', () => {
  const root = path.join(__dirname, '..', '..');

  async function legacyDatabase(name: string, drift = false) {
    const ds = new DataSource({ ...(await freshDatabase('cloud', name)), migrations: [MIGRATIONS[0]] });
    await ds.initialize();
    await ds.runMigrations();
    await ds.query('DROP TABLE migrations');
    await ds.query(`INSERT INTO users (email, "passwordHash") VALUES ('owner@example.com', 'x')`);
    if (drift) await ds.query('ALTER TABLE products ADD COLUMN legacy_note text');
    await ds.destroy();
  }

  /** Runs a script as the user would, with .env replaced by the harness database. */
  function run(script: string, database: string): { code: number; out: string } {
    const server = harnessServer('cloud');
    try {
      const out = execFileSync(process.execPath, ['-r', 'ts-node/register/transpile-only', script], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          PATH: process.env.PATH,
          TS_NODE_PROJECT: path.join(root, 'tsconfig.json'),
          DATABASE_HOST: server.host,
          DATABASE_PORT: String(server.port),
          DATABASE_USER: server.username,
          DATABASE_PASSWORD: server.password,
          DATABASE_NAME: database,
          // Must be ignored: these scripts never change anything.
          DROP_SCHEMA: 'true',
        },
      });
      return { code: 0, out };
    } catch (error: any) {
      return { code: error.status, out: `${error.stdout}${error.stderr}` };
    }
  }

  it('says it is safe to merge when production differs by exactly the new migrations', async () => {
    await legacyDatabase('predeploy_clean');
    const { code, out } = run('scripts/predeploy-check.ts', 'predeploy_clean');
    expect(out).toContain('Safe to merge');
    expect(code).toBe(0);

    // And it changed nothing: the data is still there, no migration ran.
    const ds = new DataSource(databaseOptions('cloud', 'predeploy_clean'));
    await ds.initialize();
    expect(await ds.query(`SELECT count(*)::int AS n FROM users`)).toEqual([{ n: 1 }]);
    expect(await ds.query(`SELECT to_regclass('public.migrations') AS t`)).toEqual([{ t: null }]);
    await ds.destroy();
  });

  it('stops the merge when production has drifted from the code', async () => {
    await legacyDatabase('predeploy_drift', true);
    const { code, out } = run('scripts/predeploy-check.ts', 'predeploy_drift');
    expect(out).toContain('NOT safe to merge');
    expect(out).toContain('legacy_note');
    expect(code).toBe(2);
  });

  it('backs up every row without changing anything', async () => {
    await legacyDatabase('predeploy_backup');
    const { code, out } = run('scripts/backup-json.ts', 'predeploy_backup');
    expect(code).toBe(0);
    const file = /Backup saved: (.+\.jsonl)/.exec(out)![1];
    const lines = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    rmSync(file);
    expect(lines).toEqual([{ table: 'users', row: expect.objectContaining({ email: 'owner@example.com' }) }]);
  });
});
