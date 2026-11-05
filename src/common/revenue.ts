/**
 * Which orders count as money taken, and when — shared by every report so the
 * store dashboard, the profit cards and the platform overview never disagree.
 *
 * Every fragment is fully quoted: the aliases have to survive TypeORM's own
 * rewriting of `alias.property` inside raw multi-line expressions, and the
 * caller composes them into `where()` / `select()` strings verbatim.
 */

/**
 * A restaurant order is revenue once the cashier settles it (`orderStatus` =
 * 'completed'); drafts, live tickets and cancellations are not. A general
 * store's orders never move through that lifecycle — they carry `orderStatus`
 * 'none' and settle by payment status instead.
 *
 * A CREDIT SALE is 'completed' the moment it goes on credit, but it is not
 * money until somebody collects it — then it is revenue on the day it was
 * paid (`settledAt`). The exclusion is deliberately narrow (credit rows only)
 * rather than "status = 'paid'": older restaurant rows that reached
 * 'completed' without a payment status keep counting exactly as before.
 */
export function restaurantRevenueCondition(alias: string): string {
  return (
    `("${alias}"."orderStatus" = 'completed'` +
    ` AND ("${alias}"."creditedAt" IS NULL OR "${alias}"."status" = 'paid'))`
  );
}

export function revenuePredicate(alias: string, accountType: string | null | undefined): string {
  return accountType === 'restaurant'
    ? restaurantRevenueCondition(alias)
    : `"${alias}"."status" IN ('paid', 'completed')`;
}

/**
 * The same rule across EVERY store at once, deciding per row from the joined
 * store's account type. For the platform overview, which cannot pick one
 * predicate up front.
 */
export function platformRevenuePredicate(orderAlias: string, storeAlias: string): string {
  return (
    `(("${storeAlias}"."accountType" = 'restaurant' AND ${restaurantRevenueCondition(orderAlias)})` +
    ` OR ("${storeAlias}"."accountType" <> 'restaurant' AND "${orderAlias}"."status" IN ('paid', 'completed')))`
  );
}

/**
 * When the money was TAKEN, falling back to creation for rows that predate
 * `settledAt`. Reports window on this, never on `createdAt` alone.
 */
export function settledAtExpr(alias: string): string {
  return `COALESCE("${alias}"."settledAt", "${alias}"."createdAt")`;
}

/**
 * What the customer paid for the order, delivery charge included. The owner
 * reads revenue as the money taken, so it matches the shift totals; the
 * delivery share is still reported on its own line where a screen needs it.
 */
export function revenueAmountExpr(alias: string): string {
  return `"${alias}"."total"`;
}
