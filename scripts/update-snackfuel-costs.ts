/**
 * Writes Snack Fuel's cost prices from ./snackfuel-menu.ts into the database,
 * and nothing else: no name, price, icon or sort order is touched.
 *
 *   npm run db:update-snackfuel-costs                 # dry run: prints the plan, writes nothing
 *   npm run db:update-snackfuel-costs -- --apply      # writes
 *   npm run db:update-snackfuel-costs -- --store=<uuid>
 *
 * Only menu items with a cost of their own are written. Items that fall back
 * to COST_RATIO (none at present) keep whatever cost they have. Rows are matched
 * by category and name, the same way the sync script matches them, and a menu
 * item with no row aborts the run before anything is written.
 *
 * New costs reach order lines placed from now on; existing order_items keep
 * the unitCost they were sold at.
 *
 * Before writing in --apply mode, the current cost of every row about to
 * change goes to backups/costs-<store>-<timestamp>.json.
 *
 * Safe to re-run: a second pass finds nothing to change.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { COST_RATIO, MENU, SNACKFUEL_STORE_ID, findProduct, norm, round2 } from './snackfuel-menu';

dotenv.config();

const APPLY = process.argv.includes('--apply');
const STORE_ID =
  process.argv.find((a) => a.startsWith('--store='))?.slice('--store='.length) ??
  SNACKFUEL_STORE_ID;

const BACKUP_DIR = path.join(__dirname, '../backups');

/** decimal columns come back from pg as strings. */
interface ProductRow {
  id: string;
  name: string;
  price: string;
  costPrice: string | null;
  categoryName: string | null;
}

interface Line {
  id: string;
  category: string;
  name: string;
  price: number;
  current: number | null;
  next: number;
  changes: boolean;
}

const money = (n: number | null) => (n === null ? '—' : n.toFixed(2));
const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(2)}`;

async function main() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    username: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'postgres',
    database: process.env.DATABASE_NAME || 'postgres',
    synchronize: false,
  });

  await dataSource.initialize();

  try {
    const store = await dataSource.query(
      'SELECT id, name, "accountType" FROM stores WHERE id = $1',
      [STORE_ID],
    );
    if (!store.length) {
      throw new Error(`Store ${STORE_ID} not found`);
    }
    if (store[0].accountType !== 'restaurant') {
      throw new Error(`Store ${store[0].name} is not a restaurant account`);
    }

    console.log(
      `💰 ${APPLY ? 'UPDATING COSTS for' : 'Dry run for'} ${store[0].name} (${STORE_ID})` +
        ` on ${process.env.DATABASE_HOST || 'localhost'}\n`,
    );

    const rows: ProductRow[] = await dataSource.query(
      `SELECT p.id, p.name, p.price, p."costPrice", c.name AS "categoryName"
         FROM products p
         LEFT JOIN categories c ON c.id = p."categoryId"
        WHERE p."storeId" = $1`,
      [STORE_ID],
    );

    // ---- plan, in menu order
    const lines: Line[] = [];
    const missing: string[] = [];
    const fallback: string[] = [];

    for (const group of MENU) {
      const inCategory = rows.filter(
        (r) => r.categoryName !== null && norm(r.categoryName) === norm(group.category),
      );
      for (const item of group.items) {
        if (item.cost === undefined) {
          fallback.push(item.name);
          continue;
        }
        const row = findProduct(inCategory, item);
        if (!row) {
          missing.push(`${group.category} / ${item.name}`);
          continue;
        }
        const current = row.costPrice === null ? null : Number(row.costPrice);
        lines.push({
          id: row.id,
          category: group.category,
          name: row.name,
          price: Number(row.price),
          current,
          next: item.cost,
          changes: current === null || round2(current) !== round2(item.cost),
        });
      }
    }

    const changes = lines.filter((l) => l.changes);

    // ---- report
    let lastCategory = '';
    for (const line of lines) {
      if (line.category !== lastCategory) {
        console.log(`  ${line.category}`);
        lastCategory = line.category;
      }
      const margin = line.price - line.next;
      const pct = line.price ? (margin / line.price) * 100 : 0;
      const tags: string[] = [];
      if (!line.changes) tags.push('unchanged');
      else if (line.current !== null && round2(line.current) !== round2(line.price * COST_RATIO)) {
        // Someone set this by hand; say so before it is overwritten.
        tags.push(`was hand-set`);
      }
      if (line.next >= line.price) tags.push('⚠ cost ≥ price');
      console.log(
        `    ${line.name.padEnd(32)} ${String(line.price).padStart(5)}  ` +
          `${money(line.current).padStart(8)} → ${money(line.next).padStart(8)}  ` +
          `${(line.changes ? signed(line.next - (line.current ?? 0)) : '').padStart(8)}  ` +
          `margin ${String(round2(margin)).padStart(5)} (${pct.toFixed(1)}%)` +
          (tags.length ? `  ${tags.join(', ')}` : ''),
      );
    }

    console.log(
      `\n${changes.length} to change, ${lines.length - changes.length} already correct, ` +
        `${fallback.length} without a cost of their own (left as they are):`,
    );
    console.log(`  ${fallback.join(', ')}`);

    if (missing.length) {
      console.log(`\n── menu items not found in the database ── ${missing.length}`);
      for (const name of missing) console.log(`  ${name}`);
      throw new Error('Some costed menu items have no matching product. Nothing written.');
    }

    if (!APPLY) {
      console.log('\nNothing written. Re-run with --apply to write.');
      return;
    }
    if (!changes.length) {
      console.log('\nNothing to change.');
      return;
    }

    // Backup FIRST, outside the transaction, so it exists even if the write fails.
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(BACKUP_DIR, `costs-${STORE_ID.slice(0, 8)}-${stamp}.json`);
    fs.writeFileSync(
      backupFile,
      JSON.stringify(
        {
          storeId: STORE_ID,
          storeName: store[0].name,
          takenAt: new Date().toISOString(),
          rows: changes.map((c) => ({ id: c.id, name: c.name, price: c.price, costPrice: c.current })),
        },
        null,
        2,
      ),
    );
    console.log(`\n💾 backup written to ${backupFile}`);

    // One transaction: half the menu on new costs is worse than none.
    await dataSource.transaction(async (m) => {
      for (const c of changes) {
        const result = await m.query(
          `UPDATE products SET "costPrice" = $1, "updatedAt" = now()
            WHERE id = $2 AND "storeId" = $3`,
          [c.next, c.id, STORE_ID],
        );
        if ((Array.isArray(result) ? result[1] : 0) !== 1) {
          throw new Error(`Product ${c.name} (${c.id}) was not updated`);
        }
      }
    });

    console.log(
      `\n✅ Updated ${changes.length} costs. Orders placed from now on use them; ` +
        'existing order lines keep the cost they were sold at.',
    );
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error('Cost update failed:', error.message);
  process.exit(1);
});
