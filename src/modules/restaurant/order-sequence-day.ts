import { todayInZone } from '../../common/periods';

/**
 * The trading day an order belongs to, as 'YYYY-MM-DD'.
 *
 * A restaurant's day starts at the reset hour, not at midnight: an order
 * punched at 1am after a late service still belongs to the evening before,
 * and keeps counting up from it. Shifting the clock back by the reset hour
 * and taking the calendar day in the store's zone gives exactly that.
 */
export function orderSequenceDay(now: Date, resetHour: number, timeZone: string): string {
  return todayInZone(new Date(now.getTime() - resetHour * 3_600_000), timeZone);
}

/**
 * Claims the next order number for store $1 on trading day $2.
 *
 * One atomic UPDATE … RETURNING, so two waiters punching at once still get
 * 7 and 8. A different day restarts the count at 1. A NULL day (a store that
 * has not issued a number since the column was added) carries on from the
 * counter, so a deploy in the middle of service does not hand out a second
 * order #1.
 */
export const NEXT_ORDER_SEQUENCE_SQL = `
  UPDATE "stores"
     SET "orderSequence" = CASE
           WHEN "orderSequenceDay" IS NULL OR "orderSequenceDay" = $2::date
             THEN COALESCE("orderSequence", 0) + 1
           ELSE 1
         END,
         "orderSequenceDay" = $2::date
   WHERE "id" = $1
RETURNING "orderSequence"`;
