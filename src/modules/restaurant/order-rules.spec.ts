import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import {
  applyRemovals,
  assertCanActOnBill,
  canActOnBill,
  computeTotals,
  initialStatus,
  mayPrintOnCreate,
  needsTable,
  resolveOrderType,
  resolvePayment,
  shouldReleaseClaim,
  statusAfterRemoval,
  statusAfterRound,
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

describe('canActOnBill', () => {
  const cashierA = { userId: 'a', role: 'cashier' };
  const cashierB = { userId: 'b', role: 'cashier' };
  const owner = { userId: 'o', role: 'restaurant_owner' };

  it('lets any cashier act before a bill is printed', () => {
    expect(canActOnBill({ billPrintedById: null }, cashierA)).toBe(true);
    expect(canActOnBill({}, cashierB)).toBe(true);
  });

  it('locks a printed bill to the cashier who printed it', () => {
    const order = { billPrintedById: 'a' };
    expect(canActOnBill(order, cashierA)).toBe(true);
    expect(canActOnBill(order, cashierB)).toBe(false);
  });

  it('always lets an owner step in', () => {
    expect(canActOnBill({ billPrintedById: 'a' }, owner)).toBe(true);
  });

  it('lets a supervisor step in like an owner', () => {
    expect(canActOnBill({ billPrintedById: 'a' }, { userId: 's', role: 'supervisor' })).toBe(true);
  });

  it('names the printing cashier in the refusal', () => {
    const order = { billPrintedById: 'a', billPrintedBy: { name: 'Ayesha' } };
    expect(() => assertCanActOnBill(order, cashierB)).toThrow(ForbiddenException);
    expect(() => assertCanActOnBill(order, cashierB)).toThrow(/Ayesha/);
    expect(() => assertCanActOnBill(order, cashierA)).not.toThrow();
  });
});

describe('shouldReleaseClaim', () => {
  const printedByA = { billPrintedById: 'a' };

  it('never releases an unprinted bill — there is no claim to release', () => {
    expect(shouldReleaseClaim({ billPrintedById: null }, { userId: 'w', role: 'waiter' })).toBe(false);
  });

  it("releases when a waiter adds to a printed bill — they cannot reprint it", () => {
    expect(shouldReleaseClaim(printedByA, { userId: 'w', role: 'waiter' })).toBe(true);
  });

  it('releases when a different cashier somehow adds to it', () => {
    expect(shouldReleaseClaim(printedByA, { userId: 'b', role: 'cashier' })).toBe(true);
  });

  it('keeps the claim for the cashier who holds it and for an owner', () => {
    expect(shouldReleaseClaim(printedByA, { userId: 'a', role: 'cashier' })).toBe(false);
    expect(shouldReleaseClaim(printedByA, { userId: 'o', role: 'restaurant_owner' })).toBe(false);
    expect(shouldReleaseClaim(printedByA, { userId: 's', role: 'supervisor' })).toBe(false);
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
