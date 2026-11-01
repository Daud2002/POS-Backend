import { SYNC_CHILDREN, SYNC_TABLES, SyncTable } from '../sync.config';

/**
 * The SQL behind change capture: shared tables and functions, and one
 * trigger per synced table, all generated from sync.config.ts.
 *
 * Capture lives in Postgres rather than in TypeORM subscribers because a lot
 * of this codebase writes around the ORM — raw UPDATEs (the order counter),
 * increment()/decrement() (stock), query-builder updates — and subscribers
 * never see those. A trigger sees every write, whoever made it.
 *
 * What a trigger does on each write of a synced row:
 *  1. Nothing, if the write is the sync itself applying the other side's
 *     change (`tnt.applying`), so changes never echo back and forth.
 *  2. Refuses it (TNT_STORE_SERVER_MODE) when the cloud writes a shop-owned
 *     group of a store that runs on its own server — the single-writer rule
 *     that keeps order numbers, tables and shifts from ever conflicting.
 *  3. Stamps every changed column group in sync_meta with "now" and "us".
 *  4. Records counter changes as deltas.
 */

const q = (name: string) => `"${name}"`;

/** Tables, sequence and helper functions. Created once. */
export function coreSql(): string[] {
  return [
    `CREATE SEQUENCE sync_seq`,

    `CREATE TABLE sync_state (
      id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      role text NOT NULL DEFAULT 'cloud',
      node_id text NOT NULL DEFAULT 'cloud',
      writable boolean NOT NULL DEFAULT true,
      clock_offset_ms bigint NOT NULL DEFAULT 0,
      last_cloud_time timestamptz,
      server_id uuid,
      store_id uuid,
      credential text,
      cloud_url text,
      epoch int NOT NULL DEFAULT 0,
      lease jsonb,
      lease_public_key text,
      pull_after text NOT NULL DEFAULT '0.0',
      pull_delta_after text NOT NULL DEFAULT '0.0',
      push_after text NOT NULL DEFAULT '0.0',
      push_delta_after text NOT NULL DEFAULT '0.0',
      bootstrapped_at timestamptz,
      last_sync_at timestamptz,
      last_sync_error text
    )`,
    `INSERT INTO sync_state DEFAULT VALUES`,

    `CREATE TABLE sync_meta (
      tbl text NOT NULL,
      id uuid NOT NULL,
      grp text NOT NULL,
      store_id uuid NOT NULL,
      modified_at timestamptz NOT NULL,
      origin text NOT NULL,
      deleted boolean NOT NULL DEFAULT false,
      xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
      seq bigint NOT NULL DEFAULT nextval('sync_seq'),
      PRIMARY KEY (tbl, id, grp)
    )`,
    `CREATE INDEX sync_meta_feed ON sync_meta (store_id, xid, seq)`,

    `CREATE TABLE sync_counter_deltas (
      id uuid PRIMARY KEY,
      store_id uuid NOT NULL,
      tbl text NOT NULL,
      row_id uuid NOT NULL,
      col text NOT NULL,
      delta numeric NOT NULL,
      origin text NOT NULL,
      -- false while the row it belongs to has not arrived yet; added when it does.
      applied boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
      seq bigint NOT NULL DEFAULT nextval('sync_seq')
    )`,
    `CREATE INDEX sync_counter_deltas_feed ON sync_counter_deltas (store_id, xid, seq)`,

    `CREATE TABLE sync_parked (
      tbl text NOT NULL,
      id uuid NOT NULL,
      payload jsonb NOT NULL,
      reason text,
      attempts int NOT NULL DEFAULT 0,
      first_seen timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tbl, id)
    )`,

    `CREATE TABLE sync_conflicts (
      id bigserial PRIMARY KEY,
      at timestamptz NOT NULL DEFAULT now(),
      store_id uuid,
      tbl text NOT NULL,
      row_id uuid,
      kind text NOT NULL,
      detail jsonb
    )`,

    `CREATE FUNCTION tnt_applying() RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT COALESCE(current_setting('tnt.applying', true), '') = 'on'
    $$`,

    `CREATE FUNCTION tnt_role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT role FROM sync_state
    $$`,

    // A store server's clock is corrected by the offset it measured against
    // the cloud, and never runs behind the last cloud time it has seen.
    // tnt.fake_now lets tests move time.
    `CREATE FUNCTION tnt_now() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$
      SELECT CASE
        WHEN s.role = 'cloud' THEN t.now
        ELSE GREATEST(t.now + s.clock_offset_ms * interval '1 millisecond',
                      COALESCE(s.last_cloud_time, '-infinity'::timestamptz))
      END
      FROM sync_state s,
           LATERAL (SELECT COALESCE(NULLIF(current_setting('tnt.fake_now', true), '')::timestamptz,
                                    clock_timestamp()) AS now) t
    $$`,

    // GREATEST(..., previous + 1µs): a local edit always supersedes what this
    // side already knows, even if its clock is behind the stamp it pulled.
    // Otherwise the other side would see an "older" edit and ignore it.
    `CREATE FUNCTION tnt_touch(p_tbl text, p_id uuid, p_grp text, p_store uuid, p_deleted boolean)
    RETURNS void LANGUAGE plpgsql AS $$
    DECLARE v_store uuid := p_store;
    BEGIN
      IF v_store IS NULL THEN
        SELECT store_id INTO v_store FROM sync_meta WHERE tbl = p_tbl AND id = p_id LIMIT 1;
      END IF;
      IF v_store IS NULL THEN RETURN; END IF;
      INSERT INTO sync_meta AS m (tbl, id, grp, store_id, modified_at, origin, deleted)
      VALUES (p_tbl, p_id, p_grp, v_store, tnt_now(), (SELECT node_id FROM sync_state), p_deleted)
      ON CONFLICT (tbl, id, grp) DO UPDATE SET
        store_id = EXCLUDED.store_id,
        modified_at = GREATEST(EXCLUDED.modified_at, m.modified_at + interval '1 microsecond'),
        origin = EXCLUDED.origin,
        deleted = EXCLUDED.deleted,
        xid = pg_current_xact_id(),
        seq = nextval('sync_seq');
    END $$`,

    `CREATE FUNCTION tnt_delta(p_store uuid, p_tbl text, p_id uuid, p_col text, p_delta numeric)
    RETURNS void LANGUAGE plpgsql AS $$
    BEGIN
      IF p_store IS NULL OR p_delta IS NULL OR p_delta = 0 THEN RETURN; END IF;
      INSERT INTO sync_counter_deltas (id, store_id, tbl, row_id, col, delta, origin)
      VALUES (gen_random_uuid(), p_store, p_tbl, p_id, p_col, p_delta, (SELECT node_id FROM sync_state));
    END $$`,

    // The single-writer rule, enforced where no code path can get around it.
    `CREATE FUNCTION tnt_guard(p_store uuid, p_what text) RETURNS void LANGUAGE plpgsql AS $$
    DECLARE s sync_state;
    BEGIN
      SELECT * INTO s FROM sync_state;
      IF s.role = 'cloud' THEN
        IF EXISTS (SELECT 1 FROM stores WHERE id = p_store AND "operationMode" = 'server') THEN
          RAISE EXCEPTION 'TNT_STORE_SERVER_MODE: % of this store is written by its in-shop server', p_what;
        END IF;
      ELSIF NOT s.writable THEN
        RAISE EXCEPTION 'TNT_STORE_SERVER_READ_ONLY: this store server is not the store''s active server';
      END IF;
    END $$`,
  ];
}

/** `r.` in a store expression, bound to the trigger row. */
function storeExpr(t: SyncTable, row: 'NEW' | 'OLD'): string {
  if ('column' in t.store) return `${row}.${q(t.store.column)}`;
  return t.store.sql.replace(/\br\./g, `${row}.`);
}

function touchAll(t: SyncTable, row: 'NEW' | 'OLD', deleted: boolean): string[] {
  return Object.entries(t.groups).map(([grp, g]) => {
    const touch = `PERFORM tnt_touch('${t.table}', ${row}.id, '${grp}', v_store, ${deleted});`;
    // A store server never claims a cloud-owned group; the cloud would ignore it anyway.
    return g.owner === 'cloud' ? `IF v_role = 'cloud' THEN ${touch} END IF;` : touch;
  });
}

const hasShopGroup = (t: SyncTable) => Object.values(t.groups).some((g) => g.owner === 'shop');
const guard = (t: SyncTable) => `PERFORM tnt_guard(v_store, '${t.table}');`;

function tableFunction(t: SyncTable): string {
  const lines: string[] = [];
  const add = (indent: number, ...l: string[]) => l.forEach((x) => lines.push(' '.repeat(indent) + x));

  if (t.upOnly) add(2, `IF v_role = 'cloud' THEN RETURN NULL; END IF;`);

  add(2, `IF TG_OP = 'DELETE' THEN`);
  add(4, `v_store := ${storeExpr(t, 'OLD')};`);
  if (hasShopGroup(t)) add(4, guard(t));
  add(4, ...touchAll(t, 'OLD', true));
  add(4, `RETURN NULL;`);
  add(2, `END IF;`);

  add(2, `v_store := ${storeExpr(t, 'NEW')};`);
  add(2, `IF TG_OP = 'INSERT' THEN`);
  if (hasShopGroup(t)) add(4, guard(t));
  add(4, ...touchAll(t, 'NEW', false));
  for (const c of t.counters ?? []) {
    add(4, `PERFORM tnt_delta(v_store, '${t.table}', NEW.id, '${c}', NEW.${q(c)});`);
  }
  if (t.alsoTouch) add(4, `PERFORM tnt_touch_all_${t.alsoTouch.table}(NEW.${q(t.alsoTouch.idColumn)}, v_store);`);
  add(4, `RETURN NULL;`);
  add(2, `END IF;`);

  for (const [grp, g] of Object.entries(t.groups)) {
    if (!g.columns.length) continue;
    const cols = (row: string) => `(${g.columns.map((c) => `${row}.${q(c)}`).join(', ')})`;
    add(2, `IF ${cols('NEW')} IS DISTINCT FROM ${cols('OLD')} THEN`);
    if (g.owner === 'shop') add(4, guard(t));
    const touch = `PERFORM tnt_touch('${t.table}', NEW.id, '${grp}', v_store, false);`;
    add(4, g.owner === 'cloud' ? `IF v_role = 'cloud' THEN ${touch} END IF;` : touch);
    add(2, `END IF;`);
  }
  for (const c of t.counters ?? []) {
    add(2, `IF NEW.${q(c)} IS DISTINCT FROM OLD.${q(c)} THEN`);
    add(4, `PERFORM tnt_delta(v_store, '${t.table}', NEW.id, '${c}', COALESCE(NEW.${q(c)}, 0) - COALESCE(OLD.${q(c)}, 0));`);
    add(2, `END IF;`);
  }
  if (t.alsoTouch) {
    const col = q(t.alsoTouch.idColumn);
    add(2, `IF NEW.${col} IS DISTINCT FROM OLD.${col} THEN`);
    add(4, `PERFORM tnt_touch_all_${t.alsoTouch.table}(NEW.${col}, v_store);`);
    add(2, `END IF;`);
  }
  add(2, `RETURN NULL;`);

  return `CREATE OR REPLACE FUNCTION tnt_capture_${t.table}() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_store uuid;
  v_role text := tnt_role();
BEGIN
  IF tnt_applying() THEN RETURN NULL; END IF;
${lines.join('\n')}
END $fn$`;
}

/** Re-stamps every group of a row whose store was not knowable when it was written. */
function touchAllFunction(t: SyncTable): string {
  const body = Object.entries(t.groups).map(([grp, g]) => {
    const touch = `PERFORM tnt_touch('${t.table}', p_id, '${grp}', p_store, false);`;
    return '  ' + (g.owner === 'cloud' ? `IF v_role = 'cloud' THEN ${touch} END IF;` : touch);
  });
  return `CREATE OR REPLACE FUNCTION tnt_touch_all_${t.table}(p_id uuid, p_store uuid) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v_role text := tnt_role();
BEGIN
  IF p_id IS NULL OR tnt_applying() THEN RETURN; END IF;
${body.join('\n')}
END $fn$`;
}

/** Order lines and recipe lines re-stamp the parent group they travel in. */
function childFunction(c: (typeof SYNC_CHILDREN)[number]): string {
  const parent = c.parent;
  if (!('column' in parent.store)) throw new Error(`${parent.table} needs a store column to have children`);
  const fk = q(c.foreignKey);
  const shop = parent.groups[c.group].owner === 'shop';
  return `CREATE OR REPLACE FUNCTION tnt_capture_${c.table}() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_parent uuid;
  v_store uuid;
BEGIN
  IF tnt_applying() THEN RETURN NULL; END IF;
  v_parent := CASE WHEN TG_OP = 'DELETE' THEN OLD.${fk} ELSE NEW.${fk} END;
  SELECT p.${q(parent.store.column)} INTO v_store FROM ${q(parent.table)} p WHERE p.id = v_parent;
  -- Parent already gone (a cascade): its own tombstone covers the lines.
  IF v_store IS NULL THEN RETURN NULL; END IF;
${shop ? `  PERFORM tnt_guard(v_store, '${c.table}');\n` : ''}  PERFORM tnt_touch('${parent.table}', v_parent, '${c.group}', v_store, false);
  RETURN NULL;
END $fn$`;
}

const trigger = (table: string) => [
  `DROP TRIGGER IF EXISTS tnt_sync ON ${q(table)}`,
  `CREATE TRIGGER tnt_sync AFTER INSERT OR UPDATE OR DELETE ON ${q(table)} FOR EACH ROW EXECUTE FUNCTION tnt_capture_${table}()`,
];

/** Every capture function and trigger. Safe to re-run: all CREATE OR REPLACE / DROP IF EXISTS. */
export function triggerSql(): string[] {
  const touchTargets = [...new Set(SYNC_TABLES.filter((t) => t.alsoTouch).map((t) => t.alsoTouch!.table))];
  return [
    ...touchTargets.map((name) => touchAllFunction(SYNC_TABLES.find((t) => t.table === name)!)),
    ...SYNC_TABLES.flatMap((t) => [tableFunction(t), ...trigger(t.table)]),
    ...SYNC_CHILDREN.flatMap((c) => [childFunction(c), ...trigger(c.table)]),
  ];
}
