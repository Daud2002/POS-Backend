import { parseDiscountInput, resolveDiscount } from './discount';

describe('parseDiscountInput', () => {
  it('reads a trailing % as a percentage', () => {
    expect(parseDiscountInput('25%')).toEqual({ discountType: 'percent', discountValue: 25 });
    expect(parseDiscountInput(' 25 % ')).toEqual({ discountType: 'percent', discountValue: 25 });
  });

  it('reads a bare number as a flat amount', () => {
    expect(parseDiscountInput('250')).toEqual({ discountType: 'amount', discountValue: 250 });
  });

  it('treats empty input as no discount', () => {
    expect(parseDiscountInput('')).toEqual({ discountType: null, discountValue: null });
    expect(parseDiscountInput('   ')).toEqual({ discountType: null, discountValue: null });
  });
});

describe('resolveDiscount', () => {
  it('applies a flat amount', () => {
    expect(resolveDiscount({ discountType: 'amount', discountValue: 250 }, 1000).discount).toBe(250);
  });

  it('applies a percentage of the subtotal', () => {
    expect(resolveDiscount({ discountType: 'percent', discountValue: 25 }, 2200).discount).toBe(550);
  });

  it('never discounts more than the order is worth', () => {
    // A mistyped 2500 on a 250 order would otherwise produce a negative total,
    // and `orders.total` is client-supplied in the legacy flow.
    const r = resolveDiscount({ discountType: 'amount', discountValue: 2500 }, 250);
    expect(r.discount).toBe(250);
  });

  it('caps a percentage at 100', () => {
    const r = resolveDiscount({ discountType: 'percent', discountValue: 150 }, 400);
    expect(r.discountValue).toBe(100);
    expect(r.discount).toBe(400);
  });

  it('ignores negative and non-numeric input', () => {
    expect(resolveDiscount({ discountType: 'amount', discountValue: -50 }, 500).discount).toBe(0);
    expect(resolveDiscount({ discountType: 'amount', discountValue: NaN }, 500).discount).toBe(0);
  });

  it('returns nothing when no discount was entered', () => {
    expect(resolveDiscount(undefined, 500)).toEqual({
      discountType: null,
      discountValue: null,
      discount: 0,
    });
  });

  it('rounds to two decimals', () => {
    // 33.333...% of 100 must not leak a float artefact into a money column.
    expect(resolveDiscount({ discountType: 'percent', discountValue: 33.333 }, 100).discount).toBe(33.33);
  });

  it('accepts decimals arriving as strings, as TypeORM returns them', () => {
    expect(resolveDiscount({ discountType: 'amount', discountValue: '99.5' }, 500).discount).toBe(99.5);
  });
});
