import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as path from 'path';
import { User } from '../src/entities';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

const ROLES: Array<'admin' | 'cashier' | 'manager' | 'employee' | 'customer'> = [
  'admin',
  'cashier',
  'manager',
  'employee',
  'customer',
];

const usersToSeed = [
  {
    email: 'admin@poscloud.com',
    password: 'admin123',
    name: 'Admin User',
    role: 'admin' as const,
  },
  {
    email: 'manager@poscloud.com',
    password: 'manager123',
    name: 'Manager User',
    role: 'manager' as const,
  },
  {
    email: 'cashier@poscloud.com',
    password: 'cashier123',
    name: 'Cashier User',
    role: 'cashier' as const,
  },
  {
    email: 'employee@poscloud.com',
    password: 'employee123',
    name: 'Employee User',
    role: 'employee' as const,
  },
  {
    email: 'customer@poscloud.com',
    password: 'customer123',
    name: 'Customer User',
    role: 'customer' as const,
  },
];

async function seedUsers() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    username: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'postgres',
    database: process.env.DATABASE_NAME || 'POS',
    entities: [path.join(__dirname, '../src/entities/**/*.entity{.ts,.js}')],
    synchronize: false,
    logging: false,
  });

  await dataSource.initialize();

  try {
    console.log('🌱 Starting user seeding...\n');
    const userRepository = dataSource.getRepository(User);

    let createdCount = 0;
    let skippedCount = 0;

    for (const userData of usersToSeed) {
      // Check if user already exists
      const existingUser = await userRepository.findOne({
        where: { email: userData.email },
      });

      if (existingUser) {
        console.log(`⏭️  Skipped ${userData.role} (${userData.email}) - already exists`);
        skippedCount++;
        continue;
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(userData.password, 10);

      // Create user
      const user = userRepository.create({
        email: userData.email,
        passwordHash: hashedPassword,
        name: userData.name,
        role: userData.role,
        isActive: true,
      });

      await userRepository.save(user);
      console.log(`✅ Created ${userData.role}: ${userData.email}`);
      console.log(`   Name: ${userData.name}`);
      console.log(`   Password: ${userData.password}\n`);
      createdCount++;
    }

    console.log(`\n✨ Seeding completed!`);
    console.log(`📊 Summary:`);
    console.log(`   Created: ${createdCount} users`);
    console.log(`   Skipped: ${skippedCount} users`);
    console.log(`   Total: ${createdCount + skippedCount} users\n`);
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  } finally {
    await dataSource.destroy();
  }
}

seedUsers();
