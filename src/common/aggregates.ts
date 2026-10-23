import type { SelectQueryBuilder } from 'typeorm';

/** One aggregate column: the SQL expression and the name it comes back under. */
export type AggregateColumn = [expression: string, alias: string];

/**
 * Makes the builder select ONLY these aggregate columns.
 *
 * `createQueryBuilder('o')` starts out selecting every column of the entity,
 * and addSelect() APPENDS to that. An aggregate-only query built with
 * addSelect alone therefore reaches Postgres as `SELECT "o"."id", …,
 * COUNT(*)` with no GROUP BY, which it rejects ("column o.id must appear in
 * the GROUP BY clause"). The first column goes through select(), which
 * replaces the default list; the rest append.
 */
export function selectAggregates(qb: SelectQueryBuilder<unknown>, columns: AggregateColumn[]): void {
  columns.forEach(([expression, alias], i) =>
    i === 0 ? qb.select(expression, alias) : qb.addSelect(expression, alias),
  );
}
