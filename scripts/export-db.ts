import 'reflect-metadata';
import { createConnection } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { typeormConfig } from '../src/database/typeorm.config';
import {
  User,
  Category,
  Product,
  Customer,
  Order,
  OrderItem,
} from '../src/entities';

const ENTITIES = [User, Category, Product, Customer, Order, OrderItem];
const EXPORT_FILE = path.join(__dirname, '../db-export.json');

async function exportDatabase() {
  const connection = await createConnection({
    ...typeormConfig(),
    entities: ENTITIES,
  });

  try {
    console.log('📦 Starting database export...');
    const exportData: any = {};

    for (const entity of ENTITIES) {
      const entityName = entity.name;
      const repository = connection.getRepository(entity);
      const records = await repository.find();
      exportData[entityName] = records;
      console.log(`✅ Exported ${entityName}: ${records.length} records`);
    }

    fs.writeFileSync(EXPORT_FILE, JSON.stringify(exportData, null, 2));
    console.log(`\n✨ Database export completed successfully!`);
    console.log(`📁 File saved to: ${EXPORT_FILE}`);
  } catch (error) {
    console.error('❌ Export failed:', error);
    process.exit(1);
  } finally {
    await connection.close();
  }
}

exportDatabase();
