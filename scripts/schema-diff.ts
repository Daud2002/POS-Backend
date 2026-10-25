import 'reflect-metadata';
// Nest loads .env through ConfigModule; a standalone script has to do it
// itself, or typeormConfig() silently falls back to localhost defaults.
import * as dotenv from 'dotenv';
dotenv.config();

import { DataSource } from 'typeorm';
import { typeormConfig } from '../src/database/typeorm.config';
import { ALL_ENTITIES } from '../src/database/entities';

/**
 * Prints the DDL that separates the database in .env from the entities in
 * this checkout — without running any of it.
 *
 * The backend no longer uses `synchronize`; schema changes ship as migrations
 * (src/database/migrations) and run at boot. This is the drift check to run
 * before deploying a branch with new migrations: the statements printed must
 * be exactly what those migrations do. Anything else means production has
 * drifted from the entities, and a migration written against them may fail.
 * The query runner is in "memory" mode, so the only statements that reach the
 * database are the catalogue reads that compare entities with tables.
 *
 *   npm run db:schema-diff
 */
async function main() {
  const dataSource = new DataSource({
    ...(typeormConfig() as any),
    entities: ALL_ENTITIES,
    synchronize: false,
    logging: false,
  });

  await dataSource.initialize();
  try {
    const plan = await dataSource.driver.createSchemaBuilder().log();
    const statements = plan.upQueries;

    if (!statements.length) {
      console.log('\n✅ Schema is in sync with the entities: there is nothing for a migration to do.\n');
      return;
    }

    console.log(
      `\n⚠️  ${statements.length} statement(s) separate the entities from ` +
        `${process.env.DATABASE_HOST}/${process.env.DATABASE_NAME}:\n`,
    );
    for (const statement of statements) {
      console.log(`${statement.query};`);
      if (statement.parameters?.length) {
        console.log(`  -- parameters: ${JSON.stringify(statement.parameters)}`);
      }
    }

    const destructive = statements.filter((s) =>
      /\b(DROP|ALTER COLUMN|SET NOT NULL|TYPE )\b/i.test(s.query),
    );
    if (destructive.length) {
      console.log(
        `\n🛑 ${destructive.length} statement(s) above drop, retype or tighten existing columns. ` +
          'Unless a migration in this branch does exactly this, do NOT deploy until the drift is understood.\n',
      );
      process.exitCode = 2;
    } else {
      console.log('\nAll statements are additive (new tables, indexes or nullable columns).\n');
    }
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error('❌ Schema diff failed:', error);
  process.exit(1);
});
