import { getMetadataArgsStorage } from 'typeorm';
import { ALL_ENTITIES } from '../database/entities';
import { MIGRATIONS } from '../database/migrations';
import { triggerSql } from './sql/generate';
import { SYNC_TABLES } from './sync.config';

describe('sync config', () => {
  it('has a trigger migration matching the current config', () => {
    // The newest migration that carries triggers is what databases run.
    const latest = [...MIGRATIONS].reverse().find((m: any) => Array.isArray(m.triggers)) as any;
    expect(latest).toBeDefined();
    // If this fails: sync.config.ts changed. Run `npm run sync:migration -- <Name>`.
    expect(latest.triggers).toEqual(triggerSql());
  });

  it('names only columns the entities have, and puts each in one group', () => {
    const columns = getMetadataArgsStorage().columns;
    const tableOf = new Map(
      getMetadataArgsStorage()
        .tables.filter((t) => ALL_ENTITIES.includes(t.target as any))
        .map((t) => [t.name, t.target]),
    );

    for (const t of SYNC_TABLES) {
      const target = tableOf.get(t.table);
      expect(target).toBeDefined();
      const names = new Set(
        columns.filter((c) => c.target === target).map((c) => c.options.name ?? c.propertyName),
      );
      const listed = [...Object.values(t.groups).flatMap((g) => g.columns), ...(t.counters ?? [])];
      for (const c of listed) expect([t.table, c, names.has(c)]).toEqual([t.table, c, true]);
      expect(new Set(listed).size).toBe(listed.length);
    }
  });
});
