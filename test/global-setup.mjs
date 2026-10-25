// Starts the two throwaway Postgres clusters the e2e suite runs against: one
// plays the cloud database, the other a shop's store server. Their settings
// reach the test workers through process.env; test/support/pg.ts refuses any
// connection that is not one of these.
import { startEmbeddedPostgres } from '../scripts/lib/embedded-pg.mjs';

export const HARNESS = { cloud: 54401, store: 54402 };

export default async function globalSetup() {
  const [cloud, store] = await Promise.all([
    startEmbeddedPostgres({ port: HARNESS.cloud }),
    startEmbeddedPostgres({ port: HARNESS.store }),
  ]);
  globalThis.__TNT_PG__ = [cloud, store];
  process.env.TNT_TEST_PG_CLOUD = JSON.stringify(cloud.config);
  process.env.TNT_TEST_PG_STORE = JSON.stringify(store.config);
}
