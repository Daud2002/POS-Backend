export default async function globalTeardown() {
  await Promise.all((globalThis.__TNT_PG__ ?? []).map((pg) => pg.stop()));
}
