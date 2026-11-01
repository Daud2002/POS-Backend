import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { DataSource, EntityManager } from 'typeorm';
import { StoreServer } from '../../entities';
import { SYNC_TABLES, SyncTable } from '../sync.config';
import { ApplyService } from '../shared/apply.service';
import { attachChildren, readFeed, stampsFor } from '../shared/feed';
import { EPOCH_STAMP, WireDelta, WireRow } from '../shared/wire';
import { StoreServersService } from './store-servers.service';

const q = (name: string) => `"${name}"`;
const BOOTSTRAP_BATCH = 500;
export const FEED_LIMIT = 500;

export interface PushBody {
  epoch?: number;
  rows?: WireRow[];
  deltas?: WireDelta[];
}

/** What a store server is allowed to see: its own store's rows. */
function scopeSql(t: SyncTable): string {
  if (t.table === 'stores') return 't.id = $1';
  if (t.table === 'users') {
    // The owner and staff, plus anyone the store's history points at (a
    // waiter who has since left still created last month's orders).
    return `t.id IN (SELECT "userId" FROM stores WHERE id = $1 AND "userId" IS NOT NULL
                     UNION SELECT "userId" FROM employee_details WHERE "storeId" = $1
                     UNION SELECT "createdById" FROM orders WHERE "storeId" = $1
                     UNION SELECT "settledById" FROM orders WHERE "storeId" = $1 AND "settledById" IS NOT NULL
                     UNION SELECT "billPrintedById" FROM orders WHERE "storeId" = $1 AND "billPrintedById" IS NOT NULL
                     UNION SELECT "userId" FROM cashier_shifts WHERE "storeId" = $1
                     UNION SELECT "closedById" FROM cashier_shifts WHERE "storeId" = $1 AND "closedById" IS NOT NULL
                     UNION SELECT "collectedById" FROM cashier_shifts WHERE "storeId" = $1 AND "collectedById" IS NOT NULL
                     UNION SELECT "createdById" FROM expenses WHERE "storeId" = $1 AND "createdById" IS NOT NULL)
             AND t.role <> 'admin'`;
  }
  if ('column' in t.store) return `t.${q(t.store.column)} = $1`;
  throw new Error(`No bootstrap scope for ${t.table}`);
}

/**
 * The cloud end of the sync: the first full copy, then pull and push.
 */
@Injectable()
export class CloudSyncService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly apply: ApplyService,
    private readonly servers: StoreServersService,
  ) {}

  /**
   * Streams the store's whole data set as NDJSON, from one snapshot.
   *
   * The header's cursor is the snapshot's xmin: every change from an older
   * transaction is in the copy; a change from a transaction at or after it
   * may or may not be, so pulling from there re-delivers it. Re-delivered
   * edits are harmless (equal stamps are skipped); re-delivered counter
   * deltas are not, so the ones the snapshot already includes are listed for
   * the server to mark as applied.
   */
  async bootstrap(server: StoreServer, res: Response) {
    const storeId = server.storeId;
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      await runner.startTransaction('REPEATABLE READ');
      await runner.query('SET TRANSACTION READ ONLY');
      const m = runner.manager;
      const [{ xmin }] = await m.query(`SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS xmin`);
      const cursor = `${xmin}.-1`;

      res.setHeader('Content-Type', 'application/x-ndjson');
      const write = (line: unknown) => res.write(JSON.stringify(line) + '\n');
      write({ type: 'header', cursor, deltaCursor: cursor, serverTime: new Date().toISOString(), storeId });

      const counts: Record<string, number> = {};
      for (const t of SYNC_TABLES) {
        if (t.upOnly) continue;
        counts[t.table] = 0;
        let lastId = '00000000-0000-0000-0000-000000000000';
        for (;;) {
          const batch: { id: string; row: Record<string, unknown> }[] = await m.query(
            `SELECT t.id, to_jsonb(t.*) AS row FROM ${q(t.table)} t
              WHERE ${scopeSql(t)} AND t.id > $2 ORDER BY t.id LIMIT ${BOOTSTRAP_BATCH}`,
            [storeId, lastId],
          );
          if (!batch.length) break;
          lastId = batch[batch.length - 1].id;

          const stamps = await stampsFor(m, t.table, batch.map((b) => b.id));
          const rows: WireRow[] = batch.map((b) => ({
            tbl: t.table,
            id: b.id,
            deleted: false,
            row: b.row,
            stamps: Object.fromEntries(Object.keys(t.groups).map((g) => [g, stamps.get(b.id)?.[g] ?? EPOCH_STAMP])),
          }));
          await attachChildren(m, t.table, rows);
          write({ type: 'rows', rows });
          counts[t.table] += rows.length;
        }
      }

      const deltas: WireDelta[] = await m.query(
        `SELECT id, tbl, row_id AS "rowId", col, delta::text AS delta, origin
           FROM sync_counter_deltas WHERE store_id = $1 AND xid >= $2::xid8`,
        [storeId, xmin],
      );
      write({ type: 'deltas-included', deltas });
      write({ type: 'end', counts });
      await runner.commitTransaction();
      res.end();
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      if (!res.headersSent) throw error;
      // Mid-stream: the missing 'end' line tells the server to start over.
      res.end();
    } finally {
      await runner.release();
    }
  }

  async pull(server: StoreServer, after: string, deltaAfter: string, limit = FEED_LIMIT) {
    const page = await this.dataSource.transaction('REPEATABLE READ', (m: EntityManager) =>
      readFeed(m, { storeId: server.storeId, after, deltaAfter, limit, origin: { not: server.id } }),
    );
    return { ...page, serverTime: new Date().toISOString(), store: await this.servers.writerStateOf(server.storeId) };
  }

  /**
   * Applies what a store server sends. A fenced server (one replaced by a
   * failover) is still heard: its orders and payments are facts, and the
   * collision rules in ApplyService settle the few things that can clash.
   */
  async push(server: StoreServer, body: PushBody) {
    const results = await this.dataSource.transaction((m) =>
      this.apply.apply(m, body.rows ?? [], body.deltas ?? [], { side: 'cloud', storeId: server.storeId }),
    );
    return { results, serverTime: new Date().toISOString(), store: await this.servers.writerStateOf(server.storeId) };
  }
}
