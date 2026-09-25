import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { InventoryItem } from './inventory-item.entity';

export const INVENTORY_MOVEMENT_TYPES = ['stock_in', 'sale', 'adjustment'] as const;
export type InventoryMovementType = (typeof INVENTORY_MOVEMENT_TYPES)[number];

/**
 * Every change to an ingredient's count, append-only.
 *
 * `quantity` is signed — positive in, negative out — so the sum of an item's
 * movements explains its current count, and "where did the milk go" has an
 * answer: this order, that correction.
 */
@Entity('inventory_movements')
@Index('IDX_inventory_movements_item_created', ['inventoryItemId', 'createdAt'])
export class InventoryMovement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  storeId: string;

  @Column({ type: 'uuid' })
  inventoryItemId: string;

  @Column({ type: 'varchar', length: 16, default: 'adjustment' })
  type: InventoryMovementType;

  @Column({
    type: 'decimal',
    precision: 14,
    scale: 3,
    default: 0,
    transformer: { to: (v: number) => v, from: (v: string | null) => Number(v ?? 0) },
  })
  quantity: number;

  /** The settled order a `sale` movement came from. */
  @Column({ type: 'uuid', nullable: true })
  orderId: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => InventoryItem, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'inventoryItemId' })
  inventoryItem: InventoryItem;
}
