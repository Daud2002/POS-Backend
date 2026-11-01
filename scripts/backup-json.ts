import 'reflect-metadata';
import * as dotenv from 'dotenv';
dotenv.config();

import { createWriteStream, mkdirSync } from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { typeormConfig } from '../src/database/typeorm.config';

/**
 * A full, READ-ONLY copy of the database in .env, one JSON line per row:
 *
 *   npm run db:backup   →  backups/<db>-<date>.jsonl
 *
 * For when there is no pg_dump at hand (this Mac has none) and the hosting
 * dashboard has no backup button: taken before a deploy that migrates
 * production, so every row can be put back if it ever had to be. Each line is
 * `{"table": "...", "row": {...}}`. backups/ is git-ignored: it is customer data.
 */
async function main() {
  const dataSource = new DataSource({
    ...(typeormConfig() as any),
    entities: [],
    migrations: [],
    synchronize: false,
    migrationsRun: false,
    dropSchema: false,
    logging: false,
  });
  await dataSource.initialize();

  const dir = path.join(__dirname, '..', 'backups');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `${process.env.DATABASE_NAME ?? 'db'}-${stamp}.jsonl`);
  const out = createWriteStream(file);

  try {
    // One snapshot for the whole copy, so rows from different tables agree.
    await dataSource.transaction('REPEATABLE READ', async (m) => {
      await m.query('SET TRANSACTION READ ONLY');
      const tables: { name: string }[] = await m.query(
        `SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
      );
      for (const { name } of tables) {
        let offset = 0;
        let count = 0;
        for (;;) {
          const rows: { row: unknown }[] = await m.query(
            `SELECT to_jsonb(t.*) AS row FROM "${name}" t ORDER BY ctid LIMIT 1000 OFFSET ${offset}`,
          );
          for (const r of rows) out.write(JSON.stringify({ table: name, row: r.row }) + '\n');
          count += rows.length;
          offset += rows.length;
          if (rows.length < 1000) break;
        }
        console.log(`  ${name}: ${count} row(s)`);
      }
    });
  } finally {
    await new Promise((resolve) => out.end(resolve));
    await dataSource.destroy();
  }
  console.log(`\n✅ Backup saved: ${file}\n`);
}

main().catch((error) => {
  console.error('❌ Backup failed:', error?.message ?? error);
  process.exit(1);
});
