import { typeormConfig } from './typeorm.config';

describe('typeormConfig', () => {
  it('never migrates or synchronizes unless the app asks', () => {
    // db:* scripts spread this into a DataSource pointed at production.
    expect(typeormConfig()).toMatchObject({ migrationsRun: false, synchronize: false });
  });

  it('runs migrations at app boot', () => {
    expect(typeormConfig({ runMigrations: true })).toMatchObject({ migrationsRun: true, synchronize: false });
  });
});
