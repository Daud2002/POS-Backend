import { getMetadataArgsStorage } from 'typeorm';
import * as entities from '../entities';
import { ALL_ENTITIES } from './entities';

describe('ALL_ENTITIES', () => {
  it('lists every entity class the entities folder exports', () => {
    const tables = new Set(getMetadataArgsStorage().tables.map((t) => t.target));
    const exported = Object.values(entities).filter((value) => tables.has(value as Function));

    expect(exported.length).toBeGreaterThan(0);
    for (const entity of exported) {
      expect(ALL_ENTITIES).toContain(entity);
    }
    expect(ALL_ENTITIES).toHaveLength(exported.length);
  });
});
