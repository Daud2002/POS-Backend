import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import * as path from 'path';

export const typeormConfig = (): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432', 10),
  username: process.env.DATABASE_USER || 'postgres',
  password: process.env.DATABASE_PASSWORD || 'postgres',
  database: process.env.DATABASE_NAME || 'POS',
  entities: [path.join(__dirname, '../entities/**/*.entity{.ts,.js}')],
  synchronize: true, // Auto-sync database schema in development
  logging: process.env.NODE_ENV === 'development',
  dropSchema: process.env.DROP_SCHEMA === 'true', // Set to true to drop and recreate schema
  migrationsRun: false,
  ssl: {
  rejectUnauthorized: false,
  }
});
