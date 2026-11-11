import { round2 } from './discount';

/**
 * Tips — the shared vocabulary.
 *
 * A tip is money a customer leaves on top of the bill. It is stored on the
 * order beside the bill (`tipAmount`, `tipMethod`), never inside `total`, so
 * no revenue figure can include it. Everything here is pure: which methods a
 * store records tips for, and how recorded tips are grouped for display.
 */

export type TipMethod = 'cash' | 'card' | 'online';

export const TIP_METHODS: ReadonlyArray<TipMethod> = ['cash', 'card', 'online'];

/** Which payment methods a store records tips for — the owner's switches. */
export type TipPolicy = Record<TipMethod, boolean>;

export const NO_TIPS: TipPolicy = { cash: false, card: false, online: false };

interface TipFlags {
  tipsCashEnabled?: boolean | null;
  tipsCardEnabled?: boolean | null;
  tipsOnlineEnabled?: boolean | null;
}

export function tipPolicyOf(store?: TipFlags | null): TipPolicy {
  return {
    cash: !!store?.tipsCashEnabled,
    card: !!store?.tipsCardEnabled,
    online: !!store?.tipsOnlineEnabled,
  };
}

/**
 * The order types tips are reported under. Dine-out is a dine-in that also
 * takes a parcel home — the owner counts the two as one.
 */
export type TipOrderType = 'dine_in' | 'takeaway' | 'delivery';

export const TIP_ORDER_TYPES: ReadonlyArray<TipOrderType> = ['dine_in', 'takeaway', 'delivery'];

export function tipOrderType(orderType?: string | null): TipOrderType {
  if (orderType === 'takeaway') return 'takeaway';
  if (orderType === 'delivery') return 'delivery';
  return 'dine_in';
}

/** One line of the "Tips" dropdown: tips of one order type by one method. */
export interface TipCell {
  orderType: TipOrderType;
  method: TipMethod;
  amount: number;
}

/**
 * Collects tips into the order type × method grid and hands back only the
 * cells that hold money, in a fixed order — so the list reads the same on
 * every screen and never shows a row of zeros. Nine cells at most.
 */
export class TipGrid {
  private readonly cells = new Map<string, number>();

  add(orderType: string | null | undefined, method: string | null | undefined, amount: unknown) {
    const value = Number(amount) || 0;
    if (value <= 0) return;
    if (!TIP_METHODS.includes(method as TipMethod)) return;
    const key = `${tipOrderType(orderType)}:${method}`;
    this.cells.set(key, (this.cells.get(key) ?? 0) + value);
  }

  toCells(): TipCell[] {
    const out: TipCell[] = [];
    for (const orderType of TIP_ORDER_TYPES) {
      for (const method of TIP_METHODS) {
        const amount = round2(this.cells.get(`${orderType}:${method}`) ?? 0);
        if (amount > 0) out.push({ orderType, method, amount });
      }
    }
    return out;
  }
}

/** Reads cells back from storage (a jsonb snapshot), dropping anything malformed. */
export function tipCellsFrom(raw: unknown): TipCell[] {
  const grid = new TipGrid();
  if (Array.isArray(raw)) {
    for (const cell of raw) grid.add(cell?.orderType, cell?.method, cell?.amount);
  }
  return grid.toCells();
}

/** Tips per method, summed across order types. */
export function tipsByMethod(cells: TipCell[]): Record<TipMethod, number> {
  const sum = (method: TipMethod) =>
    round2(cells.filter((c) => c.method === method).reduce((s, c) => s + c.amount, 0));
  return { cash: sum('cash'), card: sum('card'), online: sum('online') };
}

export function tipTotal(cells: TipCell[]): number {
  return round2(cells.reduce((s, c) => s + c.amount, 0));
}
