import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Product } from './product.entity';
import { InventoryItem } from './inventory-item.entity';

/**
 * One line of a product's recipe: how much of an ingredient ONE unit of the
 * product uses, in the ingredient's own unit. Selling three lattes consumes
 * three times each line.
 */
@Entity('product_ingredients')
@Index('UQ_product_ingredients_product_item', ['productId', 'inventoryItemId'], { unique: true })
export class ProductIngredient {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  productId: string;

  @Column({ type: 'uuid' })
  inventoryItemId: string;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 3,
    default: 0,
    transformer: { to: (v: number) => v, from: (v: string | null) => Number(v ?? 0) },
  })
  quantity: number;

  /** Deleting a product takes its recipe with it. */
  @ManyToOne(() => Product, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'productId' })
  product: Product;

  /**
   * RESTRICT: an ingredient still named by a recipe cannot be deleted out
   * from under it — it is retired (isActive = false) instead.
   */
  @ManyToOne(() => InventoryItem, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'inventoryItemId' })
  inventoryItem: InventoryItem;
}
