import 'reflect-metadata';
import { promises as fs } from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { ALL_ENTITIES } from '../src/database/entities';
import { MIGRATIONS } from '../src/database/migrations';

/**
 * Writes a migration for whatever the entities changed since the last one.
 *
 *   npm run migration:generate -- AddOrderSequenceDay
 *   npm run migration:generate -- Baseline --baseline   (once, already done)
 *
 * The diff is taken against a throwaway embedded Postgres that has every
 * existing migration applied, never against the database in .env. That is
 * production here, and TypeORM's own `migration:generate` would diff against
 * it, so a generated migration would depend on whatever state prod is in.
 *
 * --baseline wraps the output so it does nothing on a database that already
 * has the schema. Production was built by `synchronize` before migrations
 * existed: there the baseline is recorded as run without touching a table,
 * while a new store server gets the full schema from it.
 */
const MIGRATIONS_DIR = path.join(__dirname, '../src/database/migrations');
const PORT = 54400;

async function main() {
  const args = process.argv.slice(2);
  const baseline = args.includes('--baseline');
  const name = args.find((a) => !a.startsWith('--'));
  if (!name || !/^[A-Z][A-Za-z0-9]*$/.test(name)) {
    throw new Error('Usage: npm run migration:generate -- <PascalCaseName> [--baseline]');
  }
  if (baseline && MIGRATIONS.length) {
    throw new Error('A baseline only makes sense as the first migration.');
  }

  const { startEmbeddedPostgres } = await import('./lib/embedded-pg.mjs');
  const pg = await startEmbeddedPostgres({ port: PORT });
  try {
    const dataSource = new DataSource({
      type: 'postgres',
      ...pg.config,
      entities: ALL_ENTITIES,
      migrations: MIGRATIONS,
      synchronize: false,
      logging: false,
    });
    await dataSource.initialize();
    await dataSource.runMigrations({ transaction: 'all' });
    const { upQueries, downQueries } = await dataSource.driver.createSchemaBuilder().log();
    await dataSource.destroy();

    if (!upQueries.length) {
      console.log('No schema changes: the entities match the migrations.');
      return;
    }

    const timestamp = Date.now();
    const className = `${name}${timestamp}`;
    const file = path.join(MIGRATIONS_DIR, `${timestamp}-${name}.ts`);
    await fs.writeFile(file, render(className, upQueries, downQueries.reverse(), baseline));
    await writeIndex();
    console.log(`Wrote ${path.relative(process.cwd(), file)} (${upQueries.length} statement(s)). Read it before committing.`);
  } finally {
    await pg.stop();
  }
}

type Query = { query: string; parameters?: unknown[] };

function statement(q: Query): string {
  const sql = q.query.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  const params = q.parameters?.length ? `, ${JSON.stringify(q.parameters)}` : '';
  return `    await queryRunner.query(\`${sql}\`${params});`;
}

function render(className: string, up: Query[], down: Query[], baseline: boolean): string {
  const upBody = up.map(statement).join('\n');
  if (baseline) {
    return `import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The schema as it stood when the backend stopped using \`synchronize\`.
 *
 * Production and every database created before then already has it, built by
 * synchronize from the same entities, so on those this records itself as run
 * and changes nothing. A fresh database (a new store server) gets it all.
 */
export class ${className} implements MigrationInterface {
  name = '${className}';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const [existing] = await queryRunner.query(\`SELECT to_regclass('public.stores') AS "table"\`);
    if (existing?.table) return;

    await queryRunner.query(\`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"\`);
${upBody}
  }

  public async down(): Promise<void> {
    // Reverting this would drop every table, production's included.
    throw new Error('The baseline migration cannot be reverted.');
  }
}
`;
  }

  return `import { MigrationInterface, QueryRunner } from 'typeorm';

export class ${className} implements MigrationInterface {
  name = '${className}';

  public async up(queryRunner: QueryRunner): Promise<void> {
${upBody}
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
${down.map(statement).join('\n')}
  }
}
`;
}

/** Rebuilds migrations/index.ts from the files, oldest first. */
async function writeIndex() {
  const files = (await fs.readdir(MIGRATIONS_DIR))
    .filter((f) => /^\d+-[A-Za-z0-9]+\.ts$/.test(f))
    .sort((a, b) => Number(a.split('-')[0]) - Number(b.split('-')[0]));
  const classes = files.map((f) => {
    const [timestamp, rest] = f.replace(/\.ts$/, '').split('-');
    return { file: f.replace(/\.ts$/, ''), className: `${rest}${timestamp}` };
  });

  const imports = classes.map((c) => `import { ${c.className} } from './${c.file}';`).join('\n');
  const list = classes.map((c) => `  ${c.className},`).join('\n');
  await fs.writeFile(
    path.join(MIGRATIONS_DIR, 'index.ts'),
    `// Generated by scripts/migration-generate.ts — do not edit by hand.\n${imports}\n\nexport const MIGRATIONS: Function[] = [\n${list}\n];\n`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
