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

/**
 * How an ingredient is counted. Stock, recipes and movements are all kept in
 * this one base unit, so no conversion ever happens on the server.
 */
export const INVENTORY_UNITS = ['ml', 'g', 'bottle'] as const;
export type InventoryUnit = (typeof INVENTORY_UNITS)[number];

/**
 * A raw ingredient a restaurant keeps on hand — milk in ml, beans in grams,
 * soft drinks by the bottle.
 *
 * Quantities only: what a dish COSTS lives on the product (`costPrice`), which
 * is what the profit report reads. Keeping money off this table means a stock
 * count can never move a margin.
 */
@Entity('inventory_items')
@Index('UQ_inventory_items_store_name', ['storeId', 'name'], { unique: true })
export class InventoryItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  storeId: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 16, default: 'g' })
  unit: InventoryUnit;

  /**
   * Bottles are bought by the set; this is how many a set holds, so "4 sets"
   * on the stock-in form becomes 24 bottles. Ignored for ml and g.
   */
  @Column({ type: 'int', default: 6 })
  packSize: number;

  /**
   * On hand, in `unit`. Allowed to go NEGATIVE: a sale is never refused for
   * want of stock, so a shortfall shows up here as a count to correct rather
   * than as a customer who could not pay.
   */
  @Column({
    type: 'decimal',
    precision: 14,
    scale: 3,
    default: 0,
    transformer: { to: (v: number) => v, from: (v: string | null) => Number(v ?? 0) },
  })
  quantity: number;

  /** At or below this the item is flagged. Null means never flag it. */
  @Column({
    type: 'decimal',
    precision: 14,
    scale: 3,
    nullable: true,
    transformer: {
      to: (v: number | null) => v,
      from: (v: string | null) => (v === null ? null : Number(v)),
    },
  })
  lowStockThreshold: number | null;

  /**
   * Retiring hides an item from the recipe picker without breaking the
   * recipes and history that already name it.
   */
  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => Store)
  @JoinColumn({ name: 'storeId' })
  store: Store;
}
