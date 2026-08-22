export type DiscountType = 'amount' | 'percent';

export interface DiscountInput {
  discountType?: DiscountType | null;
  discountValue?: number | string | null;
}

export interface ResolvedDiscount {
  discountType: DiscountType | null;
  discountValue: number | null;
  /** The currency amount actually taken off the order. Always 0..subtotal. */
  discount: number;
}

/**
 * Turns the cashier's input into a currency amount.
 *
 * The client parses the typed string ("250" or "25%") into {type, value} and
 * sends that; this recomputes the amount server-side. It must never trust a
 * client-sent total: a typo of 2500 on a 250 order would otherwise produce a
 * negative total, and `orders.total` is client-supplied in the existing flow.
 */
export function resolveDiscount(
  input: DiscountInput | undefined,
  subtotal: number,
): ResolvedDiscount {
  const base = Number(subtotal) || 0;
  const type = input?.discountType ?? null;
  const raw = input?.discountValue;

  if (!type || raw === null || raw === undefined || raw === '') {
    return { discountType: null, discountValue: null, discount: 0 };
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return { discountType: type, discountValue: 0, discount: 0 };
  }

  if (type === 'percent') {
    const pct = Math.min(value, 100);
    return {
      discountType: 'percent',
      discountValue: pct,
      discount: round2((base * pct) / 100),
    };
  }

  // Flat amount, never more than the order itself.
  return {
    discountType: 'amount',
    discountValue: round2(value),
    discount: round2(Math.min(value, base)),
  };
}

/**
 * Parses what the cashier typed. Shared shape with the clients so "25%" means
 * the same thing everywhere.
 */
export function parseDiscountInput(text: string): DiscountInput {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return { discountType: null, discountValue: null };

  if (trimmed.endsWith('%')) {
    return {
      discountType: 'percent',
      discountValue: Number(trimmed.slice(0, -1).trim()) || 0,
    };
  }

  return { discountType: 'amount', discountValue: Number(trimmed) || 0 };
}

/** Money rounding. Avoids 0.1+0.2 artefacts leaking into stored totals. */
export function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
