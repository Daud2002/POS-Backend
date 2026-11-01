import { EntityManager } from 'typeorm';
import { SYNC_TABLES, syncTable } from '../sync.config';
import { FeedPage, STAMP_SQL, Stamp, WireDelta, WireRow, parseCursor } from './wire';

const q = (name: string) => `"${name}"`;

export interface FeedQuery {
  storeId: string;
  after: string;
  deltaAfter: string;
  limit: number;
  /** Changes made by this node only (push), or by anyone but it (pull). */
  origin: { only: string } | { not: string };
}

/**
 * Reads the next page of changes for one store, oldest first.
 *
 * The cursor is (transaction id, sequence), and only changes from
 * transactions older than every transaction still running are returned
 * (`xid < xmin`). A plain sequence would not do: numbers are handed out
 * before commit, so a slow transaction can commit seq 100 after the reader
 * already moved past 101, and that change would never be seen. With the xmin
 * fence, nothing can ever appear behind the cursor.
 *
 * Must run inside a REPEATABLE READ transaction, so the change list and the
 * rows it points at come from the same snapshot.
 */
export async function readFeed(m: EntityManager, query: FeedQuery): Promise<FeedPage> {
  const after = parseCursor(query.after);
  const deltaAfter = parseCursor(query.deltaAfter);
  const originSql = 'only' in query.origin ? 'origin = $5' : 'origin <> $5';
  const originValue = 'only' in query.origin ? query.origin.only : query.origin.not;

  const entries: {
    tbl: string;
    id: string;
    grp: string;
    at: string;
    origin: string;
    deleted: boolean;
    xid: string;
    seq: string;
  }[] = await m.query(
    `SELECT tbl, id, grp, ${STAMP_SQL('modified_at')} AS at, origin, deleted, xid::text AS xid, seq::text AS seq
       FROM sync_meta
      WHERE store_id = $1
        AND (xid, seq) > ($2::xid8, $3::bigint)
        AND xid < pg_snapshot_xmin(pg_current_snapshot())
        AND ${originSql}
      ORDER BY xid, seq
      LIMIT $4`,
    [query.storeId, after.xid, after.seq, query.limit, originValue],
  );

  const deltaRows: (WireDelta & { xid: string; seq: string })[] = await m.query(
    `SELECT id, tbl, row_id AS "rowId", col, delta::text AS delta, origin, xid::text AS xid, seq::text AS seq
       FROM sync_counter_deltas
      WHERE store_id = $1
        AND (xid, seq) > ($2::xid8, $3::bigint)
        AND xid < pg_snapshot_xmin(pg_current_snapshot())
        AND ${originSql}
      ORDER BY xid, seq
      LIMIT $4`,
    [query.storeId, deltaAfter.xid, deltaAfter.seq, query.limit, originValue],
  );

  const rows = await serializeRows(m, entries);
  const last = entries[entries.length - 1];
  const lastDelta = deltaRows[deltaRows.length - 1];

  return {
    rows,
    deltas: deltaRows.map(({ xid: _x, seq: _s, ...d }) => d),
    next: last ? `${last.xid}.${last.seq}` : `${after.xid}.${after.seq}`,
    nextDelta: lastDelta ? `${lastDelta.xid}.${lastDelta.seq}` : `${deltaAfter.xid}.${deltaAfter.seq}`,
    hasMore: entries.length === query.limit || deltaRows.length === query.limit,
  };
}

/**
 * Turns (table, id, group, stamp) entries into wire rows carrying the current
 * row data and child rows. Several groups of one row become one wire row.
 */
export async function serializeRows(
  m: EntityManager,
  entries: { tbl: string; id: string; grp: string; at: string; origin: string; deleted: boolean }[],
): Promise<WireRow[]> {
  const byKey = new Map<string, WireRow>();
  for (const e of entries) {
    const key = `${e.tbl}:${e.id}`;
    let row = byKey.get(key);
    if (!row) {
      row = { tbl: e.tbl, id: e.id, deleted: false, stamps: {}, row: null };
      byKey.set(key, row);
    }
    row.stamps[e.grp] = { at: e.at, origin: e.origin };
    if (e.deleted) row.deleted = true;
  }

  const wire = [...byKey.values()];
  for (const t of SYNC_TABLES) {
    const live = wire.filter((r) => r.tbl === t.table && !r.deleted);
    if (!live.length) continue;
    const ids = live.map((r) => r.id);

    const data: { id: string; row: Record<string, unknown> }[] = await m.query(
      `SELECT id, to_jsonb(t.*) AS row FROM ${q(t.table)} t WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    const found = new Map(data.map((d) => [d.id, d.row]));

    for (const r of live) {
      r.row = found.get(r.id) ?? null;
      // Changed and then deleted within the same window: its tombstone will follow.
      if (!r.row) r.deleted = true;
    }
    await attachChildren(m, t.table, live.filter((r) => r.row));
  }
  // A deleted row's stamp is enough; there is no data to send.
  for (const r of wire) if (r.deleted) r.row = null;
  return wire;
}

/** Adds every child row of the groups that have children. */
export async function attachChildren(m: EntityManager, table: string, rows: WireRow[]): Promise<void> {
  if (!rows.length) return;
  const t = syncTable(table);
  for (const [grp, g] of Object.entries(t.groups)) {
    if (!g.children) continue;
    const wanting = rows.filter((r) => r.stamps[grp]);
    if (!wanting.length) continue;
    const children: { parent: string; row: Record<string, unknown> }[] = await m.query(
      `SELECT c.${q(g.children.foreignKey)} AS parent, to_jsonb(c.*) AS row
         FROM ${q(g.children.table)} c
        WHERE c.${q(g.children.foreignKey)} = ANY($1::uuid[])`,
      [wanting.map((r) => r.id)],
    );
    for (const r of wanting) {
      r.children ??= {};
      r.children[g.children.table] = children.filter((c) => c.parent === r.id).map((c) => c.row);
    }
  }
}

/** Every group stamp a set of rows has, or the epoch for rows that predate change capture. */
export async function stampsFor(m: EntityManager, table: string, ids: string[]): Promise<Map<string, Record<string, Stamp>>> {
  const metas: { id: string; grp: string; at: string; origin: string }[] = ids.length
    ? await m.query(
        `SELECT id, grp, ${STAMP_SQL('modified_at')} AS at, origin FROM sync_meta WHERE tbl = $1 AND id = ANY($2::uuid[])`,
        [table, ids],
      )
    : [];
  const out = new Map<string, Record<string, Stamp>>();
  for (const meta of metas) {
    const stamps = out.get(meta.id) ?? {};
    stamps[meta.grp] = { at: meta.at, origin: meta.origin };
    out.set(meta.id, stamps);
  }
  return out;
}
