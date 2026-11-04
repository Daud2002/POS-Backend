import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Store } from './store.entity';
import { ExpenseCategory } from './expense-category.entity';

/**
 * A second level under an expense category — who or what the money went to
 * within it: "Petrol" → "Ahmad", "Rent" → "Shop", "Rent" → "Flat".
 *
 * Unlike categories, these are created by whoever books the expense: the
 * cashier paying a new rider for petrol types the name on the form and it is
 * filed here. Owners and supervisors tidy them up (rename, retire, delete).
 *
 * `storeId` is copied from the category rather than joined through it: sync
 * finds a row's store by its own column, and every query is store-scoped.
 */
@Entity('expense_subcategories')
@Index(['storeId', 'categoryId'])
export class ExpenseSubcategory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  storeId: string;

  @Column({ type: 'uuid' })
  categoryId: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  /** Retired: hidden from the form, kept on the expenses already booked to it. */
  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => Store)
  @JoinColumn({ name: 'storeId' })
  store: Store;

  @ManyToOne(() => ExpenseCategory, (category) => category.subcategories, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'categoryId' })
  category: ExpenseCategory;
}
