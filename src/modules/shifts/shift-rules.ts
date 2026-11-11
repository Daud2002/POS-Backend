import { round2 } from '../../common/discount';

/**
 * The drawer arithmetic of a shift, kept pure so every case the owner cares
 * about can be tested without a database.
 *
 * "Cash received" is everything taken in cash, tips included. From it:
 *
 *   cash to hand over = opening float + cash received − cash paid out
 *                       − cash tips                       (always)
 *                       − card/online tips due from cash  (when the store
 *                                                          pays them from cash)
 *
 * Cash tips are kept aside for staff whatever the settings say. Card and
 * online tips never physically reach the drawer, so they only come off the
 * handover when the owner has chosen to pay them out of it.
 */

export interface DrawerInput {
  openingFloat: number;
  /** Bills paid in cash. Tips are not in this figure. */
  cashSales: number;
  cashPaidOut: number;
  cashTips: number;
  /** Card/online tips the store pays out of this drawer; 0 when it does not. */
  tipsFromDrawer: number;
}

export interface DrawerMaths {
  /** cashSales + cashTips. */
  cashReceived: number;
  /** What the drawer holds before any tips are taken out. */
  cashInDrawer: number;
  /** The cash to hand over — what the cashier counts once tips are out. */
  expectedCash: number;
  /**
   * Card/online tips the drawer could not cover. Zero unless they came to
   * more than the cash left after the float, sales and payouts.
   */
  tipsOwed: number;
}

/** What card/online tips cost the drawer, given the store's setting. */
export function tipsDueFromDrawer(
  cardTips: number,
  onlineTips: number,
  paidFromCash: boolean,
): number {
  return paidFromCash ? round2((Number(cardTips) || 0) + (Number(onlineTips) || 0)) : 0;
}

export function drawerMaths(input: DrawerInput): DrawerMaths {
  const openingFloat = Number(input.openingFloat) || 0;
  const cashSales = Number(input.cashSales) || 0;
  const cashPaidOut = Number(input.cashPaidOut) || 0;
  const cashTips = Number(input.cashTips) || 0;
  const tipsFromDrawer = Number(input.tipsFromDrawer) || 0;

  const cashReceived = cashSales + cashTips;
  const cashInDrawer = openingFloat + cashReceived - cashPaidOut;

  // With the cash tips set aside. This is the whole formula on a shift that
  // recorded no card/online tips, and exactly what it was before tips existed.
  const afterCashTips = cashInDrawer - cashTips;

  // Tips can empty the drawer but cannot take it below zero: a cashier cannot
  // hand over a negative amount, and counting against one would report every
  // such close as "over". What the drawer could not cover is owed separately.
  const covered = Math.min(tipsFromDrawer, Math.max(afterCashTips, 0));

  return {
    cashReceived: round2(cashReceived),
    cashInDrawer: round2(cashInDrawer),
    expectedCash: round2(afterCashTips - covered),
    tipsOwed: round2(tipsFromDrawer - covered),
  };
}
