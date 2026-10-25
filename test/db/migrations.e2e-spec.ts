import { DataSource } from 'typeorm';
import { MIGRATIONS } from '../../src/database/migrations';
import { databaseOptions, freshDatabase, pendingSchemaChanges } from '../support/pg';

describe('migrations', () => {
  let dataSource: DataSource | undefined;

  afterEach(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
    dataSource = undefined;
  });

  it('build the whole schema on an empty database, as on a new store server', async () => {
    dataSource = new DataSource(await freshDatabase('store', 'migrations_fresh'));
    await dataSource.initialize();

    const ran = await dataSource.runMigrations({ transaction: 'all' });

    expect(ran).toHaveLength(MIGRATIONS.length);
    expect(await pendingSchemaChanges(dataSource)).toEqual([]);
  });

  it('leave a schema built by synchronize alone and apply only what came after', async () => {
    // Production before the switch: the baseline schema, but no record of
    // any migration having run. Build it with the baseline, then forget it.
    dataSource = new DataSource({ ...(await freshDatabase('cloud', 'migrations_legacy')), migrations: [MIGRATIONS[0]] });
    await dataSource.initialize();
    await dataSource.runMigrations();
    await dataSource.query('DROP TABLE "migrations"');
    await dataSource.query(`INSERT INTO "users" ("email", "passwordHash") VALUES ('owner@example.com', 'x')`);
    await dataSource.destroy();

    dataSource = new DataSource(databaseOptions('cloud', 'migrations_legacy'));
    await dataSource.initialize();
    const ran = await dataSource.runMigrations({ transaction: 'all' });

    expect(ran.map((m) => m.name)).toEqual(MIGRATIONS.map((m) => m.name));
    expect(await pendingSchemaChanges(dataSource)).toEqual([]);
    const [{ count }] = await dataSource.query('SELECT count(*)::int AS count FROM "users"');
    expect(count).toBe(1);
  });
});
