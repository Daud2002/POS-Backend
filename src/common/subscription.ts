/**
 * Subscription expiry arithmetic, in calendar days.
 *
 * A subscription is paid "through" a calendar date, so everything here works
 * on 'YYYY-MM-DD' strings and never on instants: there is no timezone on the
 * store, and "expires on the 21st" must mean the 21st wherever the owner is.
 * Pure, so the web and mobile apps carry the same rules and the same tests.
 */

/** The durations the Subscriptions page offers as one click. */
export const SUBSCRIPTION_PRESET_MONTHS: readonly number[] = [1, 2, 3, 6, 12];

/** Yellow this many days before expiry (inclusive) … */
export const SUBSCRIPTION_WARNING_DAYS = 3;
/** … and red from this many days before (inclusive), through expiry and beyond. */
export const SUBSCRIPTION_CRITICAL_DAYS = 1;

export type SubscriptionAlertLevel = 'none' | 'warning' | 'critical';

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** True for a real calendar date written as 'YYYY-MM-DD'. */
export function isIsoDay(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = ISO_DAY.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export function parseIsoDay(day: string): { year: number; month: number; day: number } {
  if (!isIsoDay(day)) throw new Error(`Not a calendar date: ${day}`);
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  return { year, month, day: dayOfMonth };
}

export function formatIsoDay(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The same day-of-month `months` calendar months later, clamped to the shorter
 * month: 31 Jan + 1 → 28 Feb (29 in a leap year). This is "a month's
 * subscription" as a customer understands it, not a rolling 30 days.
 */
export function addMonthsClamped(day: string, months: number): string {
  const { year, month, day: dayOfMonth } = parseIsoDay(day);
  const total = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(total / 12);
  const targetMonth = (total % 12) + 1;
  return formatIsoDay(targetYear, targetMonth, Math.min(dayOfMonth, daysInMonth(targetYear, targetMonth)));
}

export function addDays(day: string, days: number): string {
  const { year, month, day: dayOfMonth } = parseIsoDay(day);
  const shifted = new Date(Date.UTC(year, month - 1, dayOfMonth + days));
  return formatIsoDay(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** Whole calendar days from `today` until `day`; negative once it has passed. */
export function daysUntil(day: string, today: string): number {
  const a = parseIsoDay(day);
  const b = parseIsoDay(today);
  const diff = Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day);
  return Math.round(diff / 86_400_000);
}

/**
 * Where a new payment lands.
 *
 * An explicit date wins outright — that is how the admin corrects a mistake,
 * including deliberately back-dating a store into "expired". Otherwise the
 * months are added to whatever is LEFT: a store paid through next month that
 * pays for three more is paid through four months from now, not three. A
 * lapsed store starts counting from today again rather than from the old
 * expiry, so a customer who returns after a gap does not pay for the gap.
 */
export function computeNewExpiry(input: {
  today: string;
  current: string | null | undefined;
  months?: number | null;
  expiresAt?: string | null;
}): string {
  if (input.expiresAt !== undefined && input.expiresAt !== null && input.expiresAt !== '') {
    if (!isIsoDay(input.expiresAt)) throw new Error('expiresAt must be a calendar date (YYYY-MM-DD)');
    return input.expiresAt;
  }

  const months = input.months;
  if (!Number.isInteger(months) || (months as number) <= 0) {
    throw new Error('Either a number of months or an expiry date is required');
  }

  const today = input.today;
  const current = input.current && isIsoDay(input.current) ? input.current : null;
  const base = current && current > today ? current : today;
  return addMonthsClamped(base, months as number);
}

/**
 * The banner level for a store, from whole days left. Null (no expiry
 * recorded) is deliberately silent: every pre-existing store has no date, and
 * the release must not paint every dashboard red before the admin has
 * entered anything.
 */
export function subscriptionAlertLevel(daysLeft: number | null | undefined): SubscriptionAlertLevel {
  if (daysLeft === null || daysLeft === undefined || !Number.isFinite(daysLeft)) return 'none';
  if (daysLeft <= SUBSCRIPTION_CRITICAL_DAYS) return 'critical';
  if (daysLeft <= SUBSCRIPTION_WARNING_DAYS) return 'warning';
  return 'none';
}
