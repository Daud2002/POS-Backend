import 'reflect-metadata';
// Nest loads .env through ConfigModule; a standalone script has to do it
// itself, or typeormConfig() silently falls back to localhost defaults.
import * as dotenv from 'dotenv';
dotenv.config();

import { createConnection } from 'typeorm';
import { typeormConfig } from '../src/database/typeorm.config';
import * as entities from '../src/entities';

/**
 * Every entity, not just Customer: it points at Order, which points at Store
 * and User, and TypeORM refuses to build metadata for half a graph.
 */
const ALL_ENTITIES = (Object.values(entities) as unknown[]).filter(
  (value) => typeof value === 'function',
) as Function[];

/**
 * Give every customer a store.
 *
 * `customers.storeId` arrived after the table had rows. Until a row has one
 * it is invisible to every store (the API scopes every read by storeId), so
 * this assigns each unscoped customer to the store of their most recent
 * order. Customers who never placed an order cannot be placed that way; they
 * are listed, and `--store=<uuid>` assigns the leftovers to one store for a
 * single-tenant deployment.
 *
 *   npm run db:backfill-customer-store                  # dry run
 *   npm run db:backfill-customer-store -- --apply       # writes
 *   npm run db:backfill-customer-store -- --apply --store=<uuid>
 *
 * Safe to re-run: a customer that already has a store is never touched.
 */

interface UnscopedCustomer {
  id: string;
  name: string;
  phone: string;
  storeId: string | null;
  createdAt: Date;
}

interface Inferred {
  customerId: string;
  storeId: string;
  storeName: string | null;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const storeArg = process.argv.find((a) => a.startsWith('--store='));
  const fallbackStoreId = storeArg ? storeArg.split('=')[1] : undefined;

  // Cast: typeormConfig() is typed as Nest's option union, which createConnection
  // cannot narrow. `synchronize` off — a backfill must never alter the schema.
  const connection = await createConnection({
    ...(typeormConfig() as any),
    entities: ALL_ENTITIES,
    synchronize: false,
  } as any);

  try {
    const unscoped: UnscopedCustomer[] = await connection.query(
      `SELECT "id", "name", "phone", "storeId", "createdAt"
         FROM "customers"
        WHERE "storeId" IS NULL
        ORDER BY "createdAt" ASC`,
    );

    // The store of each customer's LATEST order. DISTINCT ON keeps one row
    // per customer, the ORDER BY decides which.
    const inferred: Inferred[] = await connection.query(
      `SELECT o."customerId" AS "customerId", o."storeId" AS "storeId", s."name" AS "storeName"
         FROM (
           SELECT DISTINCT ON ("customerId") "customerId", "storeId"
             FROM "orders"
            WHERE "customerId" IS NOT NULL AND "storeId" IS NOT NULL
            ORDER BY "customerId", "createdAt" DESC
         ) o
         LEFT JOIN "stores" s ON s."id" = o."storeId"`,
    );
    const inferredById = new Map(inferred.map((row) => [row.customerId, row]));

    if (fallbackStoreId) {
      const [store] = await connection.query(`SELECT "id", "name" FROM "stores" WHERE "id" = $1`, [
        fallbackStoreId,
      ]);
      if (!store) throw new Error(`--store=${fallbackStoreId} is not a store id`);
      console.log(`\nLeftovers will go to: ${store.name} (${store.id})`);
    }

    const fromOrders = unscoped.filter((c) => inferredById.has(c.id));
    const leftovers = unscoped.filter((c) => !inferredById.has(c.id));

    console.log(
      `\n${apply ? '✍️  APPLYING' : '👀 DRY RUN'} — ${unscoped.length} customers without a store`,
    );

    console.log('\n── from their latest order ──');
    for (const c of fromOrders) {
      const hit = inferredById.get(c.id)!;
      console.log(`  ${c.name.padEnd(28)} ${c.phone.padEnd(16)} → ${hit.storeName ?? hit.storeId}`);
    }
    if (!fromOrders.length) console.log('  (none)');

    console.log(
      `\n── no orders, cannot infer ── ${leftovers.length}` +
        (fallbackStoreId ? ' (will use --store)' : ' (pass --store=<uuid> to assign)'),
    );
    for (const c of leftovers) {
      console.log(`  ${c.name.padEnd(28)} ${c.phone}`);
    }

    if (!apply) {
      console.log('\n👀 Dry run — nothing was written. Re-run with --apply to commit.\n');
      return;
    }

    let written = 0;
    await connection.transaction(async (manager) => {
      for (const c of fromOrders) {
        const hit = inferredById.get(c.id)!;
        // Guarded on IS NULL so a row scoped between the read and the write
        // is left alone rather than overwritten.
        const result = await manager.query(
          `UPDATE "customers" SET "storeId" = $1 WHERE "id" = $2 AND "storeId" IS NULL`,
          [hit.storeId, c.id],
        );
        written += Array.isArray(result) ? Number(result[1]) || 0 : 0;
      }
      if (fallbackStoreId) {
        for (const c of leftovers) {
          const result = await manager.query(
            `UPDATE "customers" SET "storeId" = $1 WHERE "id" = $2 AND "storeId" IS NULL`,
            [fallbackStoreId, c.id],
          );
          written += Array.isArray(result) ? Number(result[1]) || 0 : 0;
        }
      }
    });

    console.log(`\n✅ Scoped ${written} customers.`);
    if (!fallbackStoreId && leftovers.length) {
      console.log(`   ${leftovers.length} still have no store — re-run with --store=<uuid>.`);
    }
    console.log('');
  } finally {
    await connection.close();
  }
}

main().catch((error) => {
  console.error('❌ Backfill failed:', error);
  process.exit(1);
});
