import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { OrderType, RestaurantOrderStatus } from '../../entities';
import { kitchenLines } from '../../common/kitchen-routing';
import { resolveDiscount, round2, type DiscountType } from '../../common/discount';

/**
 * Pure decisions of the restaurant order flow, kept out of the service so
 * they can be unit-tested without a database. The service owns transactions
 * and events; this file owns the rules.
 */

interface LineLike {
  skipKitchen?: boolean | null;
  isParcel?: boolean | null;
}

/** Order types that sit at a table. `dine_out` claims one exactly like `dine_in`. */
export function needsTable(orderType?: OrderType | string | null): boolean {
  return orderType === 'dine_in' || orderType === 'dine_out';
}

/**
 * Dine-in versus dine-out is no longer something the waiter picks up front:
 * it is DERIVED from the lines. Mark any line as a parcel and the order is a
 * dine-out; mark none and it is a plain dine-in. The clients send whichever
 * they last computed, but the server re-derives so an older build that still
 * sends a type cannot leave a parcel-less "dine_out" or a parcelled "dine_in".
 *
 * Takeaway and delivery are untouched: every line of those is a parcel by
 * definition, and nothing per line flags it.
 */
export function resolveOrderType(
  requested: OrderType | string,
  lines: LineLike[],
): OrderType {
  if (!needsTable(requested)) return requested as OrderType;
  return lines.some((l) => !!l.isParcel) ? 'dine_out' : 'dine_in';
}

/**
 * Where a freshly punched order starts.
 *
 * An order with nothing for the kitchen to cook — drinks only — never goes on
 * the board: it opens directly in the kitchen's terminal state, which is what
 * "ready to bill" means to the cashier.
 */
export function initialStatus(lines: LineLike[]): RestaurantOrderStatus {
  return kitchenLines(lines).length ? 'requested' : 'handed_over';
}

/**
 * Where an order goes after a further round is added.
 *
 * Kitchen lines in the round put a finished order back in front of the chef.
 * A round of drinks on a finished order leaves it where it is. Either way,
 * an order whose bill was already printed is no longer accurately billed —
 * the caller clears the print claim — so the cashier has to print again.
 */
export function statusAfterRound(
  current: RestaurantOrderStatus,
  newLines: LineLike[],
): RestaurantOrderStatus {
  const cooksSomething = kitchenLines(newLines).length > 0;
  if (cooksSomething && current === 'handed_over') return 'requested';
  return current;
}

/**
 * Where an order goes after lines are taken off it.
 *
 * The mirror of initialStatus(): if the cashier removes the last thing the
 * kitchen was cooking, the ticket has nothing left on it and the order is
 * ready to bill. A handed-over order stays handed over — the food is already
 * out, whatever was struck off.
 */
export function statusAfterRemoval(
  current: RestaurantOrderStatus,
  remainingLines: LineLike[],
): RestaurantOrderStatus {
  const stillCooking = current === 'requested' || current === 'preparing';
  if (stillCooking && kitchenLines(remainingLines).length === 0) return 'handed_over';
  return current;
}

// ------------------------------------------------------------------- totals

interface MoneyLine {
  total?: number | string | null;
}

export interface TotalsInput {
  lines: MoneyLine[];
  discountType?: DiscountType | null;
  discountValue?: number | string | null;
  deliveryCharge?: number | string | null;
  orderType?: OrderType | string | null;
}

export interface ResolvedTotals {
  subtotal: number;
  discount: number;
  discountType: DiscountType | null;
  discountValue: number | null;
  deliveryCharge: number;
  total: number;
}

/**
 * The one place an order's money is computed.
 *
 * `total = max(subtotal - discount, 0) + deliveryCharge`. The discount is
 * re-resolved from its type and value against the CURRENT subtotal every
 * time, so a 10% discount stays 10% after a round is added or a line is
 * removed — storing only the resolved amount is how it used to drift.
 *
 * The delivery charge is forced to zero on anything that is not a delivery.
 * The client cannot make a takeaway carry one by mistake, and reports can
 * sum the column without checking the type.
 */
export function computeTotals(input: TotalsInput): ResolvedTotals {
  const subtotal = round2(input.lines.reduce((sum, l) => sum + (Number(l.total) || 0), 0));
  const { discount, discountType, discountValue } = resolveDiscount(
    { discountType: input.discountType, discountValue: input.discountValue },
    subtotal,
  );

  const rawCharge = Number(input.deliveryCharge);
  const deliveryCharge =
    input.orderType === 'delivery' && Number.isFinite(rawCharge) && rawCharge > 0
      ? round2(rawCharge)
      : 0;

  return {
    subtotal,
    discount,
    discountType,
    discountValue,
    deliveryCharge,
    total: round2(Math.max(subtotal - discount, 0) + deliveryCharge),
  };
}

// ----------------------------------------------------------------- removals

export interface RemovableLine extends LineLike {
  id: string;
  productName?: string | null;
  quantity: number;
  unitPrice: number | string;
  total: number | string;
}

export interface RemovalRequest {
  orderItemId: string;
  /** How many to take off. Omitted = the whole line. */
  quantity?: number | null;
}

export interface RemovedLine<L extends RemovableLine = RemovableLine> {
  line: L;
  /** How many were removed — the whole line's quantity, or the part asked for. */
  quantity: number;
}

export interface ReducedLine {
  id: string;
  quantity: number;
  subtotal: number;
  total: number;
}

export interface RemovalPlan<L extends RemovableLine = RemovableLine> {
  /** The lines the order keeps, with reduced quantities already applied. */
  remaining: L[];
  /** What came off, for the history row and the kitchen's cancellation ticket. */
  removed: RemovedLine<L>[];
  /** Lines to delete outright. */
  deletedIds: string[];
  /** Lines that survive with a smaller quantity, and their recomputed money. */
  reducedLines: ReducedLine[];
}

/**
 * Works out what a removal request does to an order's lines, without
 * touching the database.
 *
 * Refuses anything that would leave the order in a state the rest of the
 * flow cannot handle: an unknown line, the same line twice, more than the
 * line holds, or nothing at all left — an empty order is a cancellation, and
 * cancelling is a different button with different consequences (the table is
 * freed, the kitchen keeps what it made).
 */
export function applyRemovals<L extends RemovableLine>(
  lines: L[],
  requests: RemovalRequest[],
): RemovalPlan<L> {
  if (!requests?.length) {
    throw new BadRequestException('Pick at least one item to remove');
  }

  const byId = new Map(lines.map((l) => [l.id, l]));
  const seen = new Set<string>();
  const removed: RemovedLine<L>[] = [];
  const deletedIds: string[] = [];
  const reducedLines: ReducedLine[] = [];
  const remaining: L[] = [];

  for (const request of requests) {
    const line = byId.get(request.orderItemId);
    if (!line) {
      throw new BadRequestException('That item is not on this order');
    }
    if (seen.has(line.id)) {
      throw new BadRequestException(`"${nameOf(line)}" is listed twice`);
    }
    seen.add(line.id);

    const held = Number(line.quantity) || 0;
    const asked = request.quantity === null || request.quantity === undefined ? held : request.quantity;
    if (!Number.isInteger(asked) || asked < 1) {
      throw new BadRequestException('The quantity to remove must be a whole number of one or more');
    }
    if (asked > held) {
      throw new BadRequestException(
        `Only ${held} × "${nameOf(line)}" is on the order, so ${asked} cannot be removed`,
      );
    }

    removed.push({ line, quantity: asked });

    if (asked === held) {
      deletedIds.push(line.id);
    } else {
      const quantity = held - asked;
      const money = round2((Number(line.unitPrice) || 0) * quantity);
      reducedLines.push({ id: line.id, quantity, subtotal: money, total: money });
    }
  }

  const reducedById = new Map(reducedLines.map((r) => [r.id, r]));
  for (const line of lines) {
    if (deletedIds.includes(line.id)) continue;
    const reduced = reducedById.get(line.id);
    remaining.push(reduced ? { ...line, quantity: reduced.quantity, total: reduced.total } : line);
  }

  if (!remaining.length) {
    throw new ConflictException(
      'That would leave nothing on the order. Cancel the order instead.',
    );
  }

  return { remaining, removed, deletedIds, reducedLines };
}

function nameOf(line: { productName?: string | null }): string {
  return line.productName ?? 'item';
}

// -------------------------------------------------------------------- claims

export interface BillViewer {
  userId: string;
  /** Effective role. Owners are never locked out of a bill. */
  role?: string | null;
  /** Display name, snapshotted onto history rows. */
  name?: string | null;
}

interface BillClaimable {
  billPrintedById?: string | null;
  billPrintedBy?: { name?: string | null } | null;
}

export function isOwnerRole(role?: string | null): boolean {
  return role === 'restaurant_owner' || role === 'store_owner' || role === 'super_admin';
}

/**
 * Who may step past another cashier's claim on a bill.
 *
 * Owners always could. A supervisor is the owner's stand-in on the floor —
 * the person who sorts out a table when the cashier who printed its bill has
 * gone home — so they get the same override. Kept separate from isOwnerRole()
 * because a supervisor is still staff everywhere else (their own drawer, their
 * own permissions, no staff management).
 */
export function canOverrideBill(role?: string | null): boolean {
  return isOwnerRole(role) || role === 'supervisor';
}

/**
 * Whether this user may act on a bill (reprint it, take its money, cancel it).
 *
 * The first cashier to print a bill CLAIMS the order: two tills must not both
 * be able to collect for the same table. Until a bill is printed the order is
 * open to every cashier; once printed, only the printer — or an owner or
 * supervisor, who can always step in when that cashier has gone home.
 */
export function canActOnBill(order: BillClaimable, viewer: BillViewer): boolean {
  if (!order.billPrintedById) return true;
  if (canOverrideBill(viewer.role)) return true;
  return order.billPrintedById === viewer.userId;
}

export function assertCanActOnBill(order: BillClaimable, viewer: BillViewer): void {
  if (canActOnBill(order, viewer)) return;
  const who = order.billPrintedBy?.name ? ` by ${order.billPrintedBy.name}` : ' by another cashier';
  throw new ForbiddenException(
    `This bill was printed${who}. Only they can settle it, unless an owner steps in.`,
  );
}

/**
 * Whether adding a round to a printed bill hands the order back to every till.
 *
 * A waiter's round makes the paper wrong and the waiter cannot reprint it, so
 * the claim is released and whoever bills it next prints afresh. The cashier
 * who holds the claim (or an owner) reprints as part of the same edit, so
 * their change keeps the claim — releasing it would let a second till grab an
 * order the first is mid-way through.
 */
export function shouldReleaseClaim(order: BillClaimable, viewer: BillViewer): boolean {
  if (!order.billPrintedById) return false;
  return !canActOnBill(order, viewer);
}

/**
 * Who may have the bill printed as part of creating the order.
 *
 * Printing claims the order for the printer, so a waiter must never do it —
 * their till has no printer for bills, and the claim would lock every cashier
 * out of an order nobody can settle.
 */
export function mayPrintOnCreate(role?: string | null): boolean {
  return role === 'cashier' || canOverrideBill(role);
}

// ------------------------------------------------------------------ payment

export type PaymentMethod = 'cash' | 'card' | 'check' | 'online' | 'partial';

export interface PaymentSplitInput {
  cash?: number | string | null;
  card?: number | string | null;
  online?: number | string | null;
}

/** What gets written on the order: the method, and the money by method. */
export interface ResolvedPayment {
  paymentMethod: PaymentMethod;
  paidCash: number;
  paidCard: number;
  paidOnline: number;
}

/**
 * Turns what the cashier chose into per-method amounts.
 *
 * A single method takes the whole total. 'partial' takes the split the
 * cashier typed, which MUST add up to the total to the cent — the point of
 * recording it is that the shift handover accounts for every rupee, and a
 * split that does not balance would silently create or lose money. A
 * "partial" payment that turns out to be one method is stored as that method,
 * so reports never show a split of one.
 */
export function resolvePayment(
  method: string | null | undefined,
  split: PaymentSplitInput | null | undefined,
  total: number,
): ResolvedPayment {
  const due = round2(Number(total) || 0);
  const chosen = (method ?? 'cash') as PaymentMethod;

  if (chosen !== 'partial') {
    return {
      paymentMethod: chosen,
      paidCash: chosen === 'cash' ? due : 0,
      paidCard: chosen === 'card' ? due : 0,
      paidOnline: chosen === 'online' ? due : 0,
    };
  }

  const part = (value: number | string | null | undefined, name: string) => {
    if (value === null || value === undefined || value === '') return 0;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      throw new BadRequestException(`The ${name} amount must be a number of zero or more`);
    }
    return round2(n);
  };
  const cash = part(split?.cash, 'cash');
  const card = part(split?.card, 'card');
  const online = part(split?.online, 'online');
  const sum = round2(cash + card + online);

  if (Math.abs(sum - due) > 0.009) {
    throw new BadRequestException(
      `The split adds up to ${sum.toFixed(2)}, but the bill is ${due.toFixed(2)}`,
    );
  }

  const used = [cash > 0, card > 0, online > 0].filter(Boolean).length;
  if (used <= 1) {
    // Nothing split after all: one method, or a fully discounted zero bill.
    const only: PaymentMethod = card > 0 ? 'card' : online > 0 ? 'online' : 'cash';
    return resolvePayment(only, undefined, due);
  }

  return { paymentMethod: 'partial', paidCash: cash, paidCard: card, paidOnline: online };
}
