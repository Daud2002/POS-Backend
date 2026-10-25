import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { Order } from './order.entity';

@Entity('customers')
@Index('UQ_customers_store_email', ['storeId', 'email'], { unique: true, where: '"email" IS NOT NULL' })
export class Customer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * The tenant this customer belongs to. Every read and write is scoped by
   * it, so one restaurant's delivery book never shows up in another's.
   *
   * Nullable only because the column arrived after the table had rows;
   * `scripts/backfill-customer-store.ts` assigns those from their orders.
   * Deliberately NOT a foreign key: StoresService.delete removes the store
   * row directly, and an FK here would start failing it.
   */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  storeId?: string | null;

  @Column()
  name: string;

  /**
   * Unique within a store, not across the platform. Two restaurants can both
   * know a customer by the same address, and a store server can create one
   * offline without being able to check every other tenant's book.
   */
  @Column({ nullable: true })
  email: string;

  /**
   * Stored normalised — digits and a leading '+' only — so '0300-1234567',
   * '0300 1234567' and '03001234567' are one customer. Unique per store,
   * enforced in CustomersService so the user gets a readable 409.
   */
  @Column()
  phone: string;

  @Column()
  address: string;

  @Column({ nullable: true })
  city: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  totalSpent: number;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => Order, (order) => order.customer)
  orders: Order[];
}
