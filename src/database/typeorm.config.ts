import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ALL_ENTITIES } from './entities';
import { MIGRATIONS } from './migrations';

/**
 * `runMigrations` is for the app's boot only (app.module.ts). Every db:*
 * script spreads this config into its own DataSource, and
 * DataSource.initialize() runs pending migrations whenever the flag is set:
 * defaulting it on would make a backfill script against .env (production)
 * migrate production as a side effect.
 */
export const typeormConfig = ({ runMigrations = false } = {}): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432', 10),
  username: process.env.DATABASE_USER || 'postgres',
  password: process.env.DATABASE_PASSWORD || 'postgres',
  database: process.env.DATABASE_NAME || 'POS',
  entities: ALL_ENTITIES,
  /**
   * Schema changes ship as migrations, applied at boot.
   *
   * `synchronize` used to reshape the schema to match whatever build booted,
   * which is survivable with one database but not with a store server on
   * every shop PC, each updating at its own pace. A new entity column needs
   * `npm run migration:generate -- <Name>` (see scripts/migration-generate.ts).
   */
  synchronize: false,
  migrations: MIGRATIONS,
  // One transaction for the whole batch: a boot that fails halfway leaves the
  // schema exactly at the previous version, which the updater can roll back to.
  migrationsRun: runMigrations,
  migrationsTransactionMode: 'all',
  logging: process.env.NODE_ENV === 'development',
  dropSchema: process.env.DROP_SCHEMA === 'true', // Set to true to drop and recreate schema
  // ssl: {
  // rejectUnauthorized: false,
  // }
});
