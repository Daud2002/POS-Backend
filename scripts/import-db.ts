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
const ENTITY_MAP: any = {
  User,
  Category,
  Product,
  Customer,
  Order,
  OrderItem,
};

async function importDatabase() {
  if (!fs.existsSync(EXPORT_FILE)) {
    console.error(`❌ Export file not found: ${EXPORT_FILE}`);
    console.log(`Run export-db.ts first to create the export file.`);
    process.exit(1);
  }

  const connection = await createConnection({
    ...typeormConfig(),
    entities: ENTITIES,
  });

  try {
    console.log('📥 Starting database import...');
    const exportData = JSON.parse(fs.readFileSync(EXPORT_FILE, 'utf-8'));

    for (const entityName in exportData) {
      const records = exportData[entityName];
      const Entity = ENTITY_MAP[entityName];

      if (!Entity) {
        console.warn(`⚠️  Unknown entity: ${entityName}, skipping...`);
        continue;
      }

      const repository = connection.getRepository(Entity);

      // Clear existing records (optional - comment out if you want to append)
      // await repository.clear();

      // Insert records
      for (const record of records) {
        try {
          await repository.save(record);
        } catch (error: any) {
          // Skip duplicate key errors
          if (error.code !== '23505') {
            console.warn(`⚠️  Failed to import ${entityName}:`, error.message);
          }
        }
      }

      console.log(`✅ Imported ${entityName}: ${records.length} records`);
    }

    console.log(`\n✨ Database import completed successfully!`);
  } catch (error) {
    console.error('❌ Import failed:', error);
    process.exit(1);
  } finally {
    await connection.close();
  }
}

importDatabase();
