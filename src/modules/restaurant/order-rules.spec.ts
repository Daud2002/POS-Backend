import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  applyRemovals,
  billPrintMode,
  canPrintBills,
  collectRefusal,
  compareCreditOrders,
  computeTotals,
  creditRefusal,
  holdsFromKitchen,
  initialStatus,
  isCreditOwing,
  mayPrintOnCreate,
  needsTable,
  resolveOrderType,
  resolvePayment,
  resolveTip,
  shouldReleaseClaim,
  statusAfterRemoval,
  statusAfterRound,
  writesHistory,
} from './order-rules';

describe('resolvePayment', () => {
  it('puts the whole total on a single method', () => {
    expect(resolvePayment('card', undefined, 1650)).toEqual({
      paymentMethod: 'card', paidCash: 0, paidCard: 1650, paidOnline: 0,
    });
    expect(resolvePayment(undefined, undefined, 100).paymentMethod).toBe('cash');
  });

  it('records a split that adds up to the total', () => {
    expect(resolvePayment('partial', { cash: 1000, card: 500, online: 150 }, 1650)).toEqual({
      paymentMethod: 'partial', paidCash: 1000, paidCard: 500, paidOnline: 150,
    });
  });

  it('accepts string amounts and blanks', () => {
    expect(resolvePayment('partial', { cash: '1000', card: '', online: 650 }, 1650)).toEqual({
      paymentMethod: 'partial', paidCash: 1000, paidCard: 0, paidOnline: 650,
    });
  });

  it('rejects a split that does not balance', () => {
    expect(() => resolvePayment('partial', { cash: 1000, card: 600 }, 1650)).toThrow(BadRequestException);
    expect(() => resolvePayment('partial', { cash: 1000, card: 600 }, 1650)).toThrow(/1600\.00.*1650\.00/);
    expect(() => resolvePayment('partial', undefined, 1650)).toThrow(BadRequestException);
  });

  it('rejects a negative part', () => {
    expect(() => resolvePayment('partial', { cash: 1700, card: -50 }, 1650)).toThrow(/card amount/);
  });

  it('tolerates rounding noise', () => {
    expect(resolvePayment('partial', { cash: 0.1, card: 0.2 }, 0.3).paymentMethod).toBe('partial');
  });

  it('collapses a split that is really one method', () => {
    expect(resolvePayment('partial', { cash: 0, card: 1650 }, 1650)).toEqual({
      paymentMethod: 'card', paidCash: 0, paidCard: 1650, paidOnline: 0,
    });
  });

  it('treats a zero bill as cash whatever was chosen', () => {
    expect(resolvePayment('partial', {}, 0)).toEqual({
      paymentMethod: 'cash', paidCash: 0, paidCard: 0, paidOnline: 0,
    });
  });
});

describe('needsTable', () => {
  it('is true for the two seated types only', () => {
    expect(needsTable('dine_in')).toBe(true);
    expect(needsTable('dine_out')).toBe(true);
    expect(needsTable('takeaway')).toBe(false);
    expect(needsTable('delivery')).toBe(false);
    expect(needsTable(null)).toBe(false);
  });
});

describe('resolveOrderType', () => {
  it('derives dine_out from any parcel line', () => {
    expect(resolveOrderType('dine_in', [{ isParcel: false }, { isParcel: true }])).toBe('dine_out');
  });

  it('derives dine_in when nothing is packed, even if the client said dine_out', () => {
    expect(resolveOrderType('dine_out', [{ isParcel: false }, {}])).toBe('dine_in');
  });

  it('never touches takeaway or delivery', () => {
    expect(resolveOrderType('takeaway', [{ isParcel: true }])).toBe('takeaway');
    expect(resolveOrderType('delivery', [{ isParcel: false }])).toBe('delivery');
  });
});

describe('initialStatus', () => {
  it('sends an order with kitchen lines to the kitchen', () => {
    expect(initialStatus([{ skipKitchen: true }, { skipKitchen: false }])).toBe('requested');
  });

  it('opens a drinks-only order as already handed over', () => {
    expect(initialStatus([{ skipKitchen: true }, { skipKitchen: true }])).toBe('handed_over');
  });
});

describe('statusAfterRound', () => {
  it('reopens a handed-over order when the round needs cooking', () => {
    expect(statusAfterRound('handed_over', [{ skipKitchen: false }])).toBe('requested');
  });

  it('leaves a handed-over order alone for a round of drinks', () => {
    expect(statusAfterRound('handed_over', [{ skipKitchen: true }])).toBe('handed_over');
  });

  it('does not disturb an order the kitchen is still working on', () => {
    expect(statusAfterRound('preparing', [{ skipKitchen: false }])).toBe('preparing');
    expect(statusAfterRound('requested', [{ skipKitchen: true }])).toBe('requested');
  });
});

describe('canPrintBills', () => {
  it('is every role the print-bill route admits, and nobody else', () => {
    expect(canPrintBills('cashier')).toBe(true);
    expect(canPrintBills('supervisor')).toBe(true);
    expect(canPrintBills('restaurant_owner')).toBe(true);
    expect(canPrintBills('waiter')).toBe(false);
    expect(canPrintBills('kitchen')).toBe(false);
    expect(canPrintBills(null)).toBe(false);
  });
});

describe('shouldReleaseClaim', () => {
  const printedByA = { billPrintedById: 'a' };

  it('never clears an unprinted bill — there is no marker to clear', () => {
    expect(shouldReleaseClaim({ billPrintedById: null }, { userId: 'w', role: 'waiter' })).toBe(false);
  });

  it("clears the marker when a waiter or the kitchen adds to a printed bill — they cannot reprint it", () => {
    expect(shouldReleaseClaim(printedByA, { userId: 'w', role: 'waiter' })).toBe(true);
    expect(shouldReleaseClaim(printedByA, { userId: 'k', role: 'kitchen' })).toBe(true);
  });

  it('keeps the marker for anyone who can reprint, whichever till printed it', () => {
    expect(shouldReleaseClaim(printedByA, { userId: 'a', role: 'cashier' })).toBe(false);
    expect(shouldReleaseClaim(printedByA, { userId: 'b', role: 'cashier' })).toBe(false);
    expect(shouldReleaseClaim(printedByA, { userId: 'o', role: 'restaurant_owner' })).toBe(false);
    expect(shouldReleaseClaim(printedByA, { userId: 's', role: 'supervisor' })).toBe(false);
  });
});

describe('holdsFromKitchen', () => {
  it("keeps the till's \"Print bill & update\" off the kitchen", () => {
    expect(holdsFromKitchen(false, 'cashier')).toBe(true);
    expect(holdsFromKitchen(false, 'supervisor')).toBe(true);
    expect(holdsFromKitchen(false, 'restaurant_owner')).toBe(true);
  });

  it('sends everything to the kitchen unless told otherwise', () => {
    expect(holdsFromKitchen(undefined, 'cashier')).toBe(false);
    expect(holdsFromKitchen(true, 'cashier')).toBe(false);
  });

  it("never holds back a waiter's or the kitchen's change", () => {
    expect(holdsFromKitchen(false, 'waiter')).toBe(false);
    expect(holdsFromKitchen(false, 'kitchen')).toBe(false);
    expect(holdsFromKitchen(false, null)).toBe(false);
  });
});

describe('billPrintMode', () => {
  it('refuses drafts and cancellations, prints live orders, reprints settled ones', () => {
    expect(billPrintMode({ orderStatus: 'draft' })).toBe('draft');
    expect(billPrintMode({ orderStatus: 'cancelled' })).toBe('cancelled');
    expect(billPrintMode({ orderStatus: 'completed' })).toBe('settled');
    expect(billPrintMode({ orderStatus: 'requested' })).toBe('live');
    expect(billPrintMode({ orderStatus: 'preparing' })).toBe('live');
    expect(billPrintMode({ orderStatus: 'handed_over' })).toBe('live');
  });
});

describe('mayPrintOnCreate', () => {
  it('lets a cashier or owner bill an order as it is punched', () => {
    expect(mayPrintOnCreate('cashier')).toBe(true);
    expect(mayPrintOnCreate('restaurant_owner')).toBe(true);
    expect(mayPrintOnCreate('supervisor')).toBe(true);
  });

  it('refuses a waiter or the kitchen, who would lock every till out', () => {
    expect(mayPrintOnCreate('waiter')).toBe(false);
    expect(mayPrintOnCreate('kitchen')).toBe(false);
    expect(mayPrintOnCreate(null)).toBe(false);
  });
});

describe('writesHistory', () => {
  it('records what waiters, cashiers and owners do', () => {
    expect(writesHistory('waiter')).toBe(true);
    expect(writesHistory('cashier')).toBe(true);
    expect(writesHistory('restaurant_owner')).toBe(true);
    // A system-originated row has no actor and is still kept.
    expect(writesHistory(null)).toBe(true);
    expect(writesHistory(undefined)).toBe(true);
  });

  it('records nothing a supervisor does — not even placing or printing', () => {
    expect(writesHistory('supervisor')).toBe(false);
  });
});

describe('statusAfterRemoval', () => {
  it('readies an order whose last kitchen line was struck off', () => {
    expect(statusAfterRemoval('requested', [{ skipKitchen: true }])).toBe('handed_over');
    expect(statusAfterRemoval('preparing', [])).toBe('handed_over');
  });

  it('leaves an order on the board while something is still cooking', () => {
    expect(statusAfterRemoval('requested', [{ skipKitchen: false }, { skipKitchen: true }])).toBe('requested');
    expect(statusAfterRemoval('preparing', [{ skipKitchen: false }])).toBe('preparing');
  });

  it('never moves a handed-over order — the food is already out', () => {
    expect(statusAfterRemoval('handed_over', [{ skipKitchen: true }])).toBe('handed_over');
    expect(statusAfterRemoval('handed_over', [{ skipKitchen: false }])).toBe('handed_over');
  });
});

describe('computeTotals', () => {
  const lines = [{ total: '300.00' }, { total: 200 }];

  it('sums decimal strings and numbers into a subtotal', () => {
    expect(computeTotals({ lines })).toEqual({
      subtotal: 500, discount: 0, discountType: null, discountValue: null, deliveryCharge: 0, total: 500,
    });
  });

  it('re-resolves a percentage against the current subtotal', () => {
    const t = computeTotals({ lines, discountType: 'percent', discountValue: 10 });
    expect(t.discount).toBe(50);
    expect(t.total).toBe(450);
    // A round is added: the same 10% now takes more off.
    const later = computeTotals({ lines: [...lines, { total: 500 }], discountType: 'percent', discountValue: 10 });
    expect(later.discount).toBe(100);
    expect(later.total).toBe(900);
  });

  it('clamps a flat discount to the subtotal', () => {
    const t = computeTotals({ lines, discountType: 'amount', discountValue: 9999 });
    expect(t.discount).toBe(500);
    expect(t.total).toBe(0);
  });

  it('adds the delivery charge on top of the discounted subtotal, on a delivery only', () => {
    expect(
      computeTotals({ lines, discountType: 'percent', discountValue: 10, deliveryCharge: 150, orderType: 'delivery' }),
    ).toMatchObject({ discount: 50, deliveryCharge: 150, total: 600 });
    expect(
      computeTotals({ lines, deliveryCharge: 150, orderType: 'takeaway' }),
    ).toMatchObject({ deliveryCharge: 0, total: 500 });
    expect(
      computeTotals({ lines, deliveryCharge: '100', orderType: 'delivery' }),
    ).toMatchObject({ deliveryCharge: 100, total: 600 });
  });

  it('still charges delivery on a fully discounted order', () => {
    expect(
      computeTotals({ lines, discountType: 'percent', discountValue: 100, deliveryCharge: 100, orderType: 'delivery' }),
    ).toMatchObject({ discount: 500, total: 100 });
  });

  it('ignores a negative or non-numeric charge', () => {
    expect(computeTotals({ lines, deliveryCharge: -5, orderType: 'delivery' }).deliveryCharge).toBe(0);
    expect(computeTotals({ lines, deliveryCharge: 'abc' as any, orderType: 'delivery' }).deliveryCharge).toBe(0);
  });

  it('rounds to the cent', () => {
    const t = computeTotals({ lines: [{ total: 0.1 }, { total: 0.2 }], discountType: 'percent', discountValue: 33 });
    expect(t.subtotal).toBe(0.3);
    expect(t.discount).toBe(0.1);
    expect(t.total).toBe(0.2);
  });
});

describe('applyRemovals', () => {
  const pizza = { id: 'p', productName: 'Pizza', quantity: 2, unitPrice: '500.00', total: '1000.00', skipKitchen: false };
  const pepsi = { id: 'd', productName: 'Pepsi', quantity: 3, unitPrice: 100, total: 300, skipKitchen: true };
  const lines = [pizza, pepsi];

  it('removes a whole line when no quantity is given', () => {
    const plan = applyRemovals(lines, [{ orderItemId: 'd' }]);
    expect(plan.deletedIds).toEqual(['d']);
    expect(plan.reducedLines).toEqual([]);
    expect(plan.remaining.map((l) => l.id)).toEqual(['p']);
    expect(plan.removed).toEqual([{ line: pepsi, quantity: 3 }]);
  });

  it('removes a whole line when the quantity equals what is held', () => {
    const plan = applyRemovals(lines, [{ orderItemId: 'd', quantity: 3 }]);
    expect(plan.deletedIds).toEqual(['d']);
  });

  it('reduces a line and recomputes its money from the unit price', () => {
    const plan = applyRemovals(lines, [{ orderItemId: 'p', quantity: 1 }]);
    expect(plan.deletedIds).toEqual([]);
    expect(plan.reducedLines).toEqual([{ id: 'p', quantity: 1, subtotal: 500, total: 500 }]);
    expect(plan.remaining[0]).toMatchObject({ id: 'p', quantity: 1, total: 500 });
    expect(plan.removed[0].quantity).toBe(1);
  });

  it('rejects a line that is not on the order, or listed twice', () => {
    expect(() => applyRemovals(lines, [{ orderItemId: 'x' }])).toThrow(BadRequestException);
    expect(() => applyRemovals(lines, [{ orderItemId: 'p', quantity: 1 }, { orderItemId: 'p', quantity: 1 }]))
      .toThrow(/twice/);
  });

  it('rejects removing more than the line holds, or a fractional count', () => {
    expect(() => applyRemovals(lines, [{ orderItemId: 'p', quantity: 3 }])).toThrow(/Only 2/);
    expect(() => applyRemovals(lines, [{ orderItemId: 'p', quantity: 0 }])).toThrow(BadRequestException);
    expect(() => applyRemovals(lines, [{ orderItemId: 'p', quantity: 1.5 }])).toThrow(BadRequestException);
  });

  it('refuses to empty the order — that is a cancellation', () => {
    expect(() => applyRemovals(lines, [{ orderItemId: 'p' }, { orderItemId: 'd' }])).toThrow(ConflictException);
    expect(() => applyRemovals(lines, [{ orderItemId: 'p' }, { orderItemId: 'd' }])).toThrow(/Cancel the order/);
  });

  it('refuses an empty request', () => {
    expect(() => applyRemovals(lines, [])).toThrow(BadRequestException);
  });
});

describe('creditRefusal', () => {
  it('lets any live order go on credit, printed bill or not', () => {
    for (const orderStatus of ['requested', 'preparing', 'handed_over']) {
      expect(creditRefusal({ orderStatus, status: 'unpaid' })).toBeNull();
    }
  });

  it('refuses drafts, cancellations and anything already closed', () => {
    expect(creditRefusal({ orderStatus: 'draft' })).toMatch(/kitchen/);
    expect(creditRefusal({ orderStatus: 'cancelled' })).toMatch(/cancelled/);
    expect(creditRefusal({ orderStatus: 'completed', status: 'paid' })).toMatch(/settled/);
    expect(
      creditRefusal({ orderStatus: 'completed', status: 'unpaid', creditedAt: new Date() }),
    ).toMatch(/already on credit/);
  });
});

describe('collectRefusal', () => {
  const credited = new Date('2026-11-01T10:00:00Z');

  it('collects an unpaid credit order', () => {
    expect(collectRefusal({ orderStatus: 'completed', status: 'unpaid', creditedAt: credited })).toBeNull();
  });

  it('refuses an order that was never put on credit', () => {
    expect(collectRefusal({ orderStatus: 'completed', status: 'unpaid' })).toMatch(/not a credit/);
  });

  it('refuses a credit order that is already paid', () => {
    expect(collectRefusal({ orderStatus: 'completed', status: 'paid', creditedAt: credited })).toMatch(
      /already been paid/,
    );
  });
});

describe('compareCreditOrders', () => {
  const at = (iso: string) => new Date(iso);

  it('puts every owed order first, then paid, each newest first', () => {
    const orders = [
      { id: 'paid-old', status: 'paid', creditedAt: at('2026-10-01T10:00:00Z') },
      { id: 'owed-old', status: 'unpaid', creditedAt: at('2026-10-02T10:00:00Z') },
      { id: 'paid-new', status: 'paid', creditedAt: at('2026-11-03T10:00:00Z') },
      { id: 'owed-new', status: 'unpaid', creditedAt: at('2026-11-04T10:00:00Z') },
    ];
    expect([...orders].sort(compareCreditOrders).map((o) => o.id)).toEqual([
      'owed-new',
      'owed-old',
      'paid-new',
      'paid-old',
    ]);
  });

  it('accepts ISO strings as well as dates', () => {
    const a = { status: 'unpaid', creditedAt: '2026-11-04T10:00:00Z' };
    const b = { status: 'unpaid', creditedAt: '2026-11-05T10:00:00Z' };
    expect(compareCreditOrders(a, b)).toBeGreaterThan(0);
  });

  it('knows what is still owed', () => {
    expect(isCreditOwing({ status: 'unpaid', creditedAt: at('2026-11-04T10:00:00Z') })).toBe(true);
    expect(isCreditOwing({ status: 'paid', creditedAt: at('2026-11-04T10:00:00Z') })).toBe(false);
    expect(isCreditOwing({ status: 'unpaid' })).toBe(false);
  });
});

describe('resolveTip', () => {
  const ALL = { cash: true, card: true, online: true };
  const CARD_ONLY = { cash: false, card: true, online: false };
  const NONE = { cash: false, card: false, online: false };
  const paidBy = (paymentMethod: string) => ({ paymentMethod } as any);

  it('records nothing when no tip is sent, whatever the switches say', () => {
    expect(resolveTip(undefined, paidBy('cash'), 900, NONE)).toEqual({ tipAmount: 0, tipMethod: null });
    expect(resolveTip({}, paidBy('cash'), 900, ALL)).toEqual({ tipAmount: 0, tipMethod: null });
    expect(resolveTip({ tipAmount: 0 }, paidBy('card'), 900, NONE)).toEqual({ tipAmount: 0, tipMethod: null });
    // A zero tip names no method even if the till sent one.
    expect(resolveTip({ tipAmount: 0, tipMethod: 'cash' }, paidBy('cash'), 900, ALL)).toEqual({
      tipAmount: 0,
      tipMethod: null,
    });
  });

  it('puts the tip on the method the bill was paid by', () => {
    expect(resolveTip({ tipAmount: 150 }, paidBy('card'), 900, ALL)).toEqual({ tipAmount: 150, tipMethod: 'card' });
    expect(resolveTip({ tipAmount: 99.999 }, paidBy('cash'), 900, ALL)).toEqual({ tipAmount: 100, tipMethod: 'cash' });
  });

  it('lets the tip arrive by a different method from the bill', () => {
    // Bill on the card, a note left on the table.
    expect(resolveTip({ tipAmount: 100, tipMethod: 'cash' }, paidBy('card'), 900, ALL)).toEqual({
      tipAmount: 100,
      tipMethod: 'cash',
    });
  });

  it('must be told the method on a split or a cheque', () => {
    expect(() => resolveTip({ tipAmount: 100 }, paidBy('partial'), 900, ALL)).toThrow(BadRequestException);
    expect(() => resolveTip({ tipAmount: 100 }, paidBy('check'), 900, ALL)).toThrow(/cash, card or online/);
    expect(resolveTip({ tipAmount: 100, tipMethod: 'online' }, paidBy('partial'), 900, ALL)).toEqual({
      tipAmount: 100,
      tipMethod: 'online',
    });
  });

  it('refuses a tip by a method the owner has not switched on', () => {
    expect(() => resolveTip({ tipAmount: 100 }, paidBy('cash'), 900, CARD_ONLY)).toThrow(BadRequestException);
    expect(() => resolveTip({ tipAmount: 100 }, paidBy('cash'), 900, CARD_ONLY)).toThrow(/Tips by cash/);
    expect(() => resolveTip({ tipAmount: 100, tipMethod: 'online' }, paidBy('card'), 900, CARD_ONLY)).toThrow(
      /Tips by online/,
    );
    expect(resolveTip({ tipAmount: 100 }, paidBy('card'), 900, CARD_ONLY).tipMethod).toBe('card');
    expect(() => resolveTip({ tipAmount: 100 }, paidBy('card'), 900, NONE)).toThrow(BadRequestException);
  });

  it('rejects an amount that is not a sensible number', () => {
    expect(() => resolveTip({ tipAmount: -5 }, paidBy('cash'), 900, ALL)).toThrow(BadRequestException);
    expect(() => resolveTip({ tipAmount: 'abc' }, paidBy('cash'), 900, ALL)).toThrow(BadRequestException);
    expect(() => resolveTip({ tipAmount: 50, tipMethod: 'check' }, paidBy('cash'), 900, ALL)).toThrow(
      BadRequestException,
    );
  });

  it('refuses the payment when the till was looking at a different bill', () => {
    // Another till reprinted with a discount: the 100 "tip" would be change.
    expect(() => resolveTip({ tipAmount: 100, expectedTotal: 1000 }, paidBy('cash'), 900, ALL)).toThrow(
      ConflictException,
    );
    // Refused even with no tip typed: what was received was judged against the wrong bill.
    expect(() => resolveTip({ expectedTotal: 1000 }, paidBy('cash'), 900, ALL)).toThrow(/now 900\.00/);
    expect(resolveTip({ tipAmount: 100, expectedTotal: 900 }, paidBy('cash'), 900, ALL).tipAmount).toBe(100);
    // An older till sends no expectedTotal and is not checked.
    expect(resolveTip({ tipAmount: 100 }, paidBy('cash'), 900, ALL).tipAmount).toBe(100);
  });
});
