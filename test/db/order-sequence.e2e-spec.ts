import { DataSource } from 'typeorm';
import { NEXT_ORDER_SEQUENCE_SQL } from '../../src/modules/restaurant/order-sequence-day';
import { freshDatabase } from '../support/pg';

describe('NEXT_ORDER_SEQUENCE_SQL', () => {
  let db: DataSource;
  let storeId: string;

  beforeAll(async () => {
    db = new DataSource(await freshDatabase('store', 'order_sequence'));
    await db.initialize();
    await db.runMigrations();
  });

  afterAll(() => db.destroy());

  beforeEach(async () => {
    const [store] = await db.query(`INSERT INTO "stores" ("name") VALUES ('Test kitchen') RETURNING "id"`);
    storeId = store.id;
  });

  const claim = async (day: string): Promise<number> => {
    const [rows] = await db.query(NEXT_ORDER_SEQUENCE_SQL, [storeId, day]);
    return rows[0].orderSequence;
  };

  it('counts up within a day and starts again at 1 on the next', async () => {
    expect(await claim('2026-10-23')).toBe(1);
    expect(await claim('2026-10-23')).toBe(2);
    expect(await claim('2026-10-24')).toBe(1);
    expect(await claim('2026-10-24')).toBe(2);
  });

  it('restarts even when nobody reset the counter overnight', async () => {
    await claim('2026-10-23');
    await claim('2026-10-23');
    // No 6am reset ran (the shop PC was off): the next day still begins at 1.
    expect(await claim('2026-10-25')).toBe(1);
  });

  it('continues the count after a deploy in the middle of service', async () => {
    // A store from before the column existed: 57 orders today, no day stored.
    await db.query(`UPDATE "stores" SET "orderSequence" = 57 WHERE "id" = $1`, [storeId]);
    expect(await claim('2026-10-23')).toBe(58);
    expect(await claim('2026-10-24')).toBe(1);
  });
});
