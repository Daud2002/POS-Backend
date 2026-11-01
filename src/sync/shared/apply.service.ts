import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { SYNC_TABLES, SyncGroup, SyncTable } from '../sync.config';
import { RowResult, STAMP_SQL, Stamp, WireDelta, WireRow, isNewer } from './wire';

const q = (name: string) => `"${name}"`;
const ORDER = new Map(SYNC_TABLES.map((t, i) => [t.table, i]));

export interface ApplyOptions {
  /** Which side is applying. The cloud trusts a store server with less. */
  side: 'cloud' | 'store';
  /** The one store every row in the batch must belong to. */
  storeId: string;
  /**
   * Initial copy onto an empty store server: everything is taken as is,
   * counters included (they have no deltas from before capture existed).
   */
  bootstrap?: boolean;
}

interface LocalStamp extends Stamp {
  deleted: boolean;
}

/** TypeORM returns [rows, count] for UPDATE/DELETE … RETURNING and bare rows for SELECT. */
const rowsOf = (raw: any): any[] => (Array.isArray(raw?.[0]) ? raw[0] : raw) ?? [];

/**
 * Applies the other side's changes to this database.
 *
 * Every write here runs with `tnt.applying` on, so the capture triggers stay
 * quiet and nothing echoes back. Each row gets its own savepoint: one row that
 * cannot be applied (its parent has not arrived yet, a name clash) never
 * blocks the rest of the batch.
 *
 * Rules, per row:
 * - Each column group is applied only if its stamp is newer than ours.
 * - A row we do not have is inserted whole; one we deleted more recently
 *   than the incoming edit stays deleted.
 * - A delete is applied only if it is newer than every edit we hold, and is
 *   refused while other rows still reference it (a reference beats a delete;
 *   the row is re-stamped here so it flows back to the other side).
 * - Counters are never taken from the row: they move only by deltas.
 */
@Injectable()
export class ApplyService {
  private readonly logger = new Logger(ApplyService.name);
  private columns?: Map<string, Set<string>>;

  /** Must run inside a transaction: the applying flag and the savepoints are per transaction. */
  async apply(m: EntityManager, rows: WireRow[], deltas: WireDelta[], opts: ApplyOptions): Promise<RowResult[]> {
    await this.loadColumns(m);
    await m.query(`SELECT set_config('tnt.applying', 'on', true)`);

    const upserts = rows.filter((r) => !r.deleted).sort((a, b) => rank(a) - rank(b));
    const deletes = rows.filter((r) => r.deleted).sort((a, b) => rank(b) - rank(a));

    const results: RowResult[] = [];
    for (const row of [...upserts, ...deletes]) results.push(await this.applyRow(m, row, opts));

    // Rows that arrived before their parent: the parent may be in this batch.
    await this.retryParked(m, opts);

    for (const delta of deltas) await this.applyDelta(m, delta, opts);
    return results;
  }

  // ------------------------------------------------------------------ rows

  private async applyRow(m: EntityManager, row: WireRow, opts: ApplyOptions, retried = false): Promise<RowResult> {
    const t = SYNC_TABLES.find((x) => x.table === row.tbl);
    if (!t) return { tbl: row.tbl, id: row.id, status: 'rejected', reason: 'not a synced table' };

    if (opts.side === 'cloud') {
      const problem = await this.ownershipProblem(m, t, row, opts.storeId);
      if (problem) return { tbl: row.tbl, id: row.id, status: 'rejected', reason: problem };
    }

    await m.query('SAVEPOINT tnt_row');
    try {
      const status = row.deleted ? await this.applyDelete(m, t, row, opts) : await this.applyUpsert(m, t, row, opts);
      await m.query('RELEASE SAVEPOINT tnt_row');
      if (status === 'applied') await m.query(`DELETE FROM sync_parked WHERE tbl = $1 AND id = $2`, [row.tbl, row.id]);
      return { tbl: row.tbl, id: row.id, status };
    } catch (error: any) {
      await m.query('ROLLBACK TO SAVEPOINT tnt_row');
      await m.query('RELEASE SAVEPOINT tnt_row');

      if (error?.code === '23503' && row.deleted) {
        await this.keepReferenced(m, t, row.id, opts.storeId);
        return { tbl: row.tbl, id: row.id, status: 'stale', reason: 'still referenced; kept' };
      }
      if (error?.code === '23503') {
        await this.park(m, row, error.detail ?? error.message);
        return { tbl: row.tbl, id: row.id, status: 'parked', reason: 'waiting for a row it refers to' };
      }
      if (error?.code === '23505' && !retried) {
        const resolved = await this.resolveCollision(m, t, row, error.constraint, opts);
        if (resolved) return this.applyRow(m, resolved, opts, true);
      }
      await this.conflict(m, opts.storeId, row.tbl, row.id, 'rejected', { message: error?.message });
      this.logger.warn(`Could not apply ${row.tbl} ${row.id}: ${error?.message}`);
      return { tbl: row.tbl, id: row.id, status: 'rejected', reason: error?.message };
    }
  }

  private async applyUpsert(m: EntityManager, t: SyncTable, row: WireRow, opts: ApplyOptions) {
    if (!row.row) return 'rejected' as const;
    const local = await this.localStamps(m, t.table, row.id);

    const winning = Object.entries(row.stamps).filter(([grp, stamp]) => {
      const g = t.groups[grp];
      if (!g) return false;
      // Platform fields are the cloud's to set, whatever a store server sends.
      if (opts.side === 'cloud' && g.owner === 'cloud') return false;
      return opts.bootstrap || isNewer(stamp, local.get(grp));
    });
    if (!winning.length) return 'stale' as const;

    const exists = rowsOf(await m.query(`SELECT 1 FROM ${q(t.table)} WHERE id = $1`, [row.id])).length > 0;
    if (!exists) {
      const tomb = [...local.values()].find((l) => l.deleted);
      if (tomb && !opts.bootstrap && !winning.some(([, s]) => isNewer(s, tomb))) return 'stale' as const;
      await this.insertRow(m, t, row.row, opts);
      for (const g of Object.values(t.groups)) {
        if (g.children && row.children?.[g.children.table]) {
          await this.replaceChildren(m, g, row.id, row.children[g.children.table]);
        }
      }
    } else {
      for (const [grp] of winning) {
        const g = t.groups[grp];
        if (g.columns.length) await this.updateColumns(m, t, row.id, row.row, [...g.columns, ...(t.touch ?? [])]);
        if (g.children) await this.replaceChildren(m, g, row.id, row.children?.[g.children.table] ?? []);
      }
    }

    for (const [grp, stamp] of winning) await this.writeStamp(m, t.table, row.id, grp, opts.storeId, stamp, false);
    return 'applied' as const;
  }

  private async applyDelete(m: EntityManager, t: SyncTable, row: WireRow, opts: ApplyOptions) {
    const local = await this.localStamps(m, t.table, row.id);
    const incoming = newest(Object.values(row.stamps));
    const latestEdit = newest([...local.values()].filter((l) => !l.deleted));
    if (!opts.bootstrap && latestEdit && incoming && !isNewer(incoming, latestEdit)) return 'stale' as const;

    // Child lines have no cascade of their own (order lines): remove them first.
    for (const g of Object.values(t.groups)) {
      if (g.children) {
        await m.query(`DELETE FROM ${q(g.children.table)} WHERE ${q(g.children.foreignKey)} = $1`, [row.id]);
      }
    }
    await m.query(`DELETE FROM ${q(t.table)} WHERE id = $1`, [row.id]);
    for (const [grp, stamp] of Object.entries(row.stamps)) {
      if (t.groups[grp]) await this.writeStamp(m, t.table, row.id, grp, opts.storeId, stamp, true);
    }
    return 'applied' as const;
  }

  private async insertRow(m: EntityManager, t: SyncTable, rowData: Record<string, unknown>, opts: ApplyOptions) {
    const data = { ...rowData };
    if (!opts.bootstrap) {
      // A counter is the sum of its deltas; the row's own copy is the sender's running total.
      for (const c of t.counters ?? []) {
        const [{ total }] = rowsOf(
          await m.query(
            `SELECT COALESCE(sum(delta), 0)::text AS total FROM sync_counter_deltas WHERE tbl = $1 AND row_id = $2 AND col = $3`,
            [t.table, data.id, c],
          ),
        );
        data[c] = total;
      }
    }
    // A store server may add staff, but never a platform admin.
    if (t.table === 'users' && opts.side === 'cloud') data.role = 'employee';

    const cols = Object.keys(data).filter((k) => this.hasColumn(t.table, k));
    await m.query(
      `INSERT INTO ${q(t.table)} (${cols.map(q).join(', ')})
       SELECT ${cols.map((c) => `r.${q(c)}`).join(', ')} FROM jsonb_populate_record(NULL::${q(t.table)}, $1::jsonb) r`,
      [JSON.stringify(data)],
    );
    if (!opts.bootstrap && t.counters?.length) {
      await m.query(`UPDATE sync_counter_deltas SET applied = true WHERE tbl = $1 AND row_id = $2 AND NOT applied`, [
        t.table,
        data.id,
      ]);
    }
  }

  private async updateColumns(m: EntityManager, t: SyncTable, id: string, data: Record<string, unknown>, columns: string[]) {
    const cols = columns.filter((c) => c in data && this.hasColumn(t.table, c));
    if (!cols.length) return;
    await m.query(
      `UPDATE ${q(t.table)} AS t SET (${cols.map(q).join(', ')}) = ROW(${cols.map((c) => `r.${q(c)}`).join(', ')})
         FROM jsonb_populate_record(NULL::${q(t.table)}, $1::jsonb) r
        WHERE t.id = $2`,
      [JSON.stringify(data), id],
    );
  }

  /** The incoming set of lines replaces ours: lines it lacks go, the rest are upserted. */
  private async replaceChildren(m: EntityManager, g: SyncGroup, parentId: string, children: Record<string, unknown>[]) {
    const { table, foreignKey } = g.children!;
    const own = children.filter((c) => c[foreignKey] === parentId);
    await m.query(`DELETE FROM ${q(table)} WHERE ${q(foreignKey)} = $1 AND NOT (id = ANY($2::uuid[]))`, [
      parentId,
      own.map((c) => c.id),
    ]);
    for (const child of own) {
      const cols = Object.keys(child).filter((k) => this.hasColumn(table, k));
      const updates = cols.filter((c) => c !== 'id');
      await m.query(
        `INSERT INTO ${q(table)} (${cols.map(q).join(', ')})
         SELECT ${cols.map((c) => `r.${q(c)}`).join(', ')} FROM jsonb_populate_record(NULL::${q(table)}, $1::jsonb) r
         ON CONFLICT (id) DO UPDATE SET (${updates.map(q).join(', ')}) = ROW(${updates.map((c) => `EXCLUDED.${q(c)}`).join(', ')})`,
        [JSON.stringify(child)],
      );
    }
  }

  // ---------------------------------------------------------------- deltas

  private async applyDelta(m: EntityManager, d: WireDelta, opts: ApplyOptions) {
    const t = SYNC_TABLES.find((x) => x.table === d.tbl);
    if (!t?.counters?.includes(d.col) || !/^-?\d+(\.\d+)?$/.test(d.delta)) {
      this.logger.warn(`Ignoring delta ${d.id} for ${d.tbl}.${d.col}`);
      return;
    }

    if (opts.side === 'cloud') {
      const owner = rowsOf(await m.query(`SELECT "storeId" FROM ${q(t.table)} WHERE id = $1`, [d.rowId]))[0];
      if (owner && owner.storeId !== opts.storeId) return;
    }

    const inserted = rowsOf(
      await m.query(
        `INSERT INTO sync_counter_deltas (id, store_id, tbl, row_id, col, delta, origin, applied)
         VALUES ($1, $2, $3, $4, $5, $6::numeric, $7, false)
         ON CONFLICT (id) DO NOTHING RETURNING id`,
        [d.id, opts.storeId, d.tbl, d.rowId, d.col, d.delta, d.origin],
      ),
    );
    if (!inserted.length) return; // already applied once

    const updated = rowsOf(
      await m.query(
        `UPDATE ${q(t.table)} SET ${q(d.col)} = COALESCE(${q(d.col)}, 0) + $1::numeric WHERE id = $2 RETURNING id`,
        [d.delta, d.rowId],
      ),
    );
    // No row yet: stays pending, and is added when the row arrives (insertRow).
    if (updated.length) await m.query(`UPDATE sync_counter_deltas SET applied = true WHERE id = $1`, [d.id]);
  }

  /**
   * Deltas the bootstrap copy already reflects: remembered as applied, so
   * when the feed re-delivers them they are not added a second time.
   */
  async recordApplied(m: EntityManager, deltas: WireDelta[], storeId: string) {
    for (const d of deltas) {
      await m.query(
        `INSERT INTO sync_counter_deltas (id, store_id, tbl, row_id, col, delta, origin, applied)
         VALUES ($1, $2, $3, $4, $5, $6::numeric, $7, true) ON CONFLICT (id) DO NOTHING`,
        [d.id, storeId, d.tbl, d.rowId, d.col, d.delta, d.origin],
      );
    }
  }

  // -------------------------------------------------------------- recovery

  private async park(m: EntityManager, row: WireRow, reason: string) {
    await m.query(
      `INSERT INTO sync_parked (tbl, id, payload, reason) VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (tbl, id) DO UPDATE SET payload = EXCLUDED.payload, reason = EXCLUDED.reason,
         attempts = sync_parked.attempts + 1`,
      [row.tbl, row.id, JSON.stringify(row), reason],
    );
  }

  async retryParked(m: EntityManager, opts: ApplyOptions) {
    for (let pass = 0; pass < 3; pass++) {
      const parked: { payload: WireRow }[] = rowsOf(await m.query(`SELECT payload FROM sync_parked ORDER BY first_seen`));
      if (!parked.length) return;
      let progress = false;
      for (const p of parked.sort((a, b) => rank(a.payload) - rank(b.payload))) {
        const result = await this.applyRow(m, p.payload, opts);
        if (result.status !== 'parked') {
          await m.query(`DELETE FROM sync_parked WHERE tbl = $1 AND id = $2`, [p.payload.tbl, p.payload.id]);
          progress = true;
        }
      }
      if (!progress) return;
    }
  }

  /** A delete that other rows still point at is undone by re-stamping the row, so it flows back. */
  private async keepReferenced(m: EntityManager, t: SyncTable, id: string, storeId: string) {
    for (const grp of Object.keys(t.groups)) {
      await m.query(`SELECT tnt_touch($1, $2, $3, $4, false)`, [t.table, id, grp, storeId]);
    }
    await this.conflict(m, storeId, t.table, id, 'kept-referenced', null);
  }

  /**
   * Unique clashes that two sides can produce honestly, and how each is
   * settled. Fixes to OUR rows are made as local edits (capture back on), so
   * they flow to the other side and both converge. Returns the row to retry.
   */
  private async resolveCollision(
    m: EntityManager,
    t: SyncTable,
    row: WireRow,
    constraint: string | undefined,
    opts: ApplyOptions,
  ): Promise<WireRow | null> {
    const data = row.row;
    if (!data) return null;
    const asLocalEdit = async (sql: string, params: unknown[]) => {
      await m.query(`SELECT set_config('tnt.applying', 'off', true)`);
      try {
        await m.query(sql, params);
      } finally {
        await m.query(`SELECT set_config('tnt.applying', 'on', true)`);
      }
    };

    switch (constraint) {
      case 'UQ_categories_store_sort_order':
      case 'UQ_products_store_sort_order':
        // The incoming row keeps the slot; ours moves to the end.
        await asLocalEdit(
          `UPDATE ${q(t.table)} SET "sortOrder" = (SELECT COALESCE(max("sortOrder"), 0) + 1 FROM ${q(t.table)} WHERE "storeId" = $1)
            WHERE "storeId" = $1 AND "sortOrder" = $2 AND id <> $3`,
          [data.storeId, data.sortOrder, row.id],
        );
        break;
      case 'UQ_inventory_items_store_name':
      case 'UQ_restaurant_table_name_per_store':
        await asLocalEdit(
          `UPDATE ${q(t.table)} SET name = left(name, 90) || ' (2)' WHERE "storeId" = $1 AND name = $2 AND id <> $3`,
          [data.storeId, data.name, row.id],
        );
        break;
      case 'UQ_customers_store_email':
        return this.noted(m, opts, row, constraint, { ...row, row: { ...data, email: null } });
      case 'UQ_orders_live_table_v2':
        // Two live orders on one table can only come from a failover. Keep
        // the order, free it from the table, and let a person sort it out.
        return this.noted(m, opts, row, constraint, { ...row, row: { ...data, tableId: null } });
      case 'UQ_cashier_shifts_open_user':
        return this.noted(m, opts, row, constraint, { ...row, row: { ...data, status: 'closed' } });
      default:
        return null;
    }
    await this.conflict(m, opts.storeId, row.tbl, row.id, constraint!, null);
    return row;
  }

  private async noted(m: EntityManager, opts: ApplyOptions, row: WireRow, kind: string, retry: WireRow) {
    await this.conflict(m, opts.storeId, row.tbl, row.id, kind, null);
    return retry;
  }

  private async conflict(m: EntityManager, storeId: string, tbl: string, id: string, kind: string, detail: unknown) {
    await m.query(`INSERT INTO sync_conflicts (store_id, tbl, row_id, kind, detail) VALUES ($1, $2, $3, $4, $5::jsonb)`, [
      storeId,
      tbl,
      id,
      kind,
      JSON.stringify(detail),
    ]);
  }

  // ------------------------------------------------------------- ownership

  /**
   * A store server's credential lives on a customer's PC, so the cloud checks
   * that everything it pushes belongs to its own store and cannot reach into
   * another tenant's rows.
   */
  private async ownershipProblem(m: EntityManager, t: SyncTable, row: WireRow, storeId: string): Promise<string | null> {
    if (t.table === 'stores') return row.id === storeId ? null : 'another store';

    if (t.table === 'users') {
      const linked = rowsOf(
        await m.query(
          `SELECT u.role,
                  EXISTS (SELECT 1 FROM stores s WHERE s."userId" = u.id AND s.id = $2) OR
                  EXISTS (SELECT 1 FROM employee_details e WHERE e."userId" = u.id AND e."storeId" = $2) AS ours
             FROM users u WHERE u.id = $1`,
          [row.id, storeId],
        ),
      )[0];
      if (!linked) return null; // a new member of staff
      return linked.ours && linked.role !== 'admin' ? null : 'a user of another store';
    }

    if ('column' in t.store) {
      const col = t.store.column;
      if (row.row && row.row[col] !== storeId) return 'another store';
      const existing = rowsOf(await m.query(`SELECT ${q(col)} AS store FROM ${q(t.table)} WHERE id = $1`, [row.id]))[0];
      if (existing && existing.store !== storeId) return 'another store';
    }
    return null;
  }

  // ----------------------------------------------------------------- stamps

  private async localStamps(m: EntityManager, table: string, id: string): Promise<Map<string, LocalStamp>> {
    const rows: (LocalStamp & { grp: string })[] = rowsOf(
      await m.query(`SELECT grp, ${STAMP_SQL('modified_at')} AS at, origin, deleted FROM sync_meta WHERE tbl = $1 AND id = $2`, [
        table,
        id,
      ]),
    );
    return new Map(rows.map((r) => [r.grp, r]));
  }

  /** Records the incoming stamp, with a fresh place in OUR feed (so the cloud can pass it on). */
  private async writeStamp(m: EntityManager, tbl: string, id: string, grp: string, storeId: string, stamp: Stamp, deleted: boolean) {
    await m.query(
      `INSERT INTO sync_meta (tbl, id, grp, store_id, modified_at, origin, deleted)
       VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7)
       ON CONFLICT (tbl, id, grp) DO UPDATE SET store_id = EXCLUDED.store_id, modified_at = EXCLUDED.modified_at,
         origin = EXCLUDED.origin, deleted = EXCLUDED.deleted, xid = pg_current_xact_id(), seq = nextval('sync_seq')`,
      [tbl, id, grp, storeId, stamp.at, stamp.origin, deleted],
    );
  }

  /** Loaded once: columns this database actually has, so a newer sender's extra columns are skipped. */
  async loadColumns(m: EntityManager) {
    if (this.columns) return;
    const rows: { table_name: string; column_name: string }[] = await m.query(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()`,
    );
    this.columns = new Map();
    for (const r of rows) {
      if (!this.columns.has(r.table_name)) this.columns.set(r.table_name, new Set());
      this.columns.get(r.table_name)!.add(r.column_name);
    }
  }

  private hasColumn(table: string, column: string): boolean {
    if (!this.columns) throw new Error('ApplyService.loadColumns() must run before apply()');
    return this.columns.get(table)?.has(column) ?? false;
  }
}

const rank = (r: WireRow) => ORDER.get(r.tbl) ?? 99;

function newest(stamps: Stamp[]): Stamp | null {
  return stamps.reduce<Stamp | null>((best, s) => (isNewer(s, best) ? s : best), null);
}
