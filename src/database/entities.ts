import {
  AuditLog,
  CashierShift,
  Category,
  Customer,
  Employee,
  Expense,
  ExpenseCategory,
  InventoryItem,
  InventoryMovement,
  Order,
  OrderEvent,
  OrderItem,
  Product,
  ProductIngredient,
  RefreshToken,
  RestaurantTable,
  Store,
  SubscriptionPayment,
  User,
} from '../entities';

/**
 * Every entity, listed rather than globbed.
 *
 * The old `dist/**\/*.entity.js` glob only worked from the compiled build and
 * depends on path separators, which a Windows store server gets wrong. The
 * list also has to be complete: TypeORM builds metadata for the whole graph,
 * and a migration generated from half of it would drop the other half.
 * entities.spec.ts fails if an entity is exported but missing here.
 */
export const ALL_ENTITIES = [
  User,
  Store,
  Employee,
  RefreshToken,
  Category,
  Product,
  ProductIngredient,
  InventoryItem,
  InventoryMovement,
  Customer,
  RestaurantTable,
  Order,
  OrderItem,
  OrderEvent,
  CashierShift,
  Expense,
  ExpenseCategory,
  AuditLog,
  SubscriptionPayment,
];
