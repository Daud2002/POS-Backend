/**
 * What travels between the cloud and a store server.
 *
 * A row always carries its full current data, so the receiver can insert it
 * if it has never seen it (or deleted it and must resurrect it), but only the
 * groups listed in `stamps` are applied, each only if its stamp is newer than
 * what the receiver already holds for that group.
 */

/** When and where a group was last edited. `at` is fixed-width ISO with µs, so it compares as text. */
export interface Stamp {
  at: string;
  origin: string;
}

export interface WireRow {
  tbl: string;
  id: string;
  deleted: boolean;
  stamps: Record<string, Stamp>;
  /** to_jsonb() of the row; null for a tombstone. */
  row: Record<string, unknown> | null;
  /** Child rows of groups that have children, keyed by child table. */
  children?: Record<string, Record<string, unknown>[]>;
}

/** A +/- change to a counter column, applied exactly once on the other side. */
export interface WireDelta {
  id: string;
  tbl: string;
  rowId: string;
  col: string;
  /** numeric as text, so no precision is lost on the way. */
  delta: string;
  origin: string;
}

export interface FeedPage {
  rows: WireRow[];
  deltas: WireDelta[];
  /** Cursor after the last change in this page, as `<xid>.<seq>`. */
  next: string;
  nextDelta: string;
  hasMore: boolean;
}

/** What the cloud tells a store server about its store on every response. */
export interface StoreWriterState {
  operationMode: 'cloud' | 'server';
  writerServerId: string | null;
  writerEpoch: number;
}

export type RowStatus = 'applied' | 'stale' | 'parked' | 'rejected';

export interface RowResult {
  tbl: string;
  id: string;
  status: RowStatus;
  reason?: string;
}

/** Postgres renders timestamptz this way for stamps: UTC, microseconds, fixed width. */
export const STAMP_SQL = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export const EPOCH_STAMP: Stamp = { at: '1970-01-01T00:00:00.000000Z', origin: 'cloud' };

/** Strictly newer: later time, or the same time from a "greater" origin, so both sides agree on ties. */
export function isNewer(incoming: Stamp, local: Stamp | null | undefined): boolean {
  if (!local) return true;
  if (incoming.at !== local.at) return incoming.at > local.at;
  return incoming.origin > local.origin;
}

export function parseCursor(cursor: string | undefined | null): { xid: string; seq: string } {
  const [xid, seq] = String(cursor ?? '0.0').split('.');
  if (!/^\d+$/.test(xid ?? '') || !/^-?\d+$/.test(seq ?? '')) return { xid: '0', seq: '0' };
  return { xid, seq };
}
