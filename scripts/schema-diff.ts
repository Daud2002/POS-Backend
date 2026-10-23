import 'reflect-metadata';
// Nest loads .env through ConfigModule; a standalone script has to do it
// itself, or typeormConfig() silently falls back to localhost defaults.
import * as dotenv from 'dotenv';
dotenv.config();

import { DataSource } from 'typeorm';
import { typeormConfig } from '../src/database/typeorm.config';
import * as entities from '../src/entities';

/**
 * Every entity, not just the new ones: TypeORM refuses to build metadata for
 * half a graph, and the diff must see the whole schema anyway.
 */
const ALL_ENTITIES = (Object.values(entities) as unknown[]).filter(
  (value) => typeof value === 'function',
) as Function[];

/**
 * Prints the DDL that the NEXT backend start would run — without running it.
 *
 * The app boots with `synchronize: true` against whatever database `.env`
 * points at, which in this project is production. There are no migrations,
 * so the only way to know what a restart will do to the schema is to ask
 * TypeORM's schema builder for its plan: this is exactly what
 * `migration:generate` does under the hood, with the query runner in
 * "memory" mode so nothing is executed. The only statements that reach the
 * database are the catalogue reads that compare entities with tables.
 *
 *   npm run db:schema-diff
 *
 * Read the output before restarting. Expect only CREATE TABLE / CREATE INDEX
 * and ALTER TABLE … ADD nullable columns; a DROP, a type change or a NOT NULL
 * addition means an entity no longer matches what is deployed and must be
 * fixed before anything is restarted.
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
      console.log('\n✅ Schema is in sync — a backend restart would run no DDL.\n');
      return;
    }

    console.log(
      `\n⚠️  A backend restart (synchronize: true) would run ${statements.length} statement(s) against ` +
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
          'Do NOT restart until the entity that caused it is corrected.\n',
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
