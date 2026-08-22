import { randomBytes } from 'crypto';

/**
 * Builds a unique order number.
 *
 * `orders.orderNumber` is a UNIQUE column and was previously derived from
 * `Date.now()` alone. With a single cashier that effectively never collided;
 * with several waiters punching at once it does, and the collision surfaces as
 * a 500 on a unique-violation. The random suffix removes the same-millisecond
 * race without needing a sequence table.
 */
export function generateOrderNumber(prefix = 'ORD'): string {
  const suffix = randomBytes(3).toString('hex').slice(0, 4).toUpperCase();
  return `${prefix}-${Date.now()}-${suffix}`;
}
