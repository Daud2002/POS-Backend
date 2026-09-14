/**
 * The reporting windows a dashboard shows, computed in the STORE's day.
 *
 * There is no timezone on the store, so the client sends its own IANA zone
 * and "today" is the user's calendar day — the same convention the expense
 * summary follows. Everything here is pure so it can be unit-tested without
 * a database; the only date arithmetic that touches Postgres is a plain
 * `>= :instant` comparison.
 *
 * Two representations come out of one calculation:
 *  - `instants` — UTC Dates, for `orders.settledAt` / `createdAt` (timestamp
 *    columns compared against JS Date params, as every other report does);
 *  - `days` — 'YYYY-MM-DD' strings, for `expenses.expenseDate`, which is a
 *    calendar DATE with no time-of-day at all.
 * `allTime` is null in both, meaning "no lower bound".
 */
export type PeriodKey =
  | 'today'
  | 'thisMonth'
  | 'last3Months'
  | 'last6Months'
  | 'thisYear'
  | 'allTime';

export const PERIOD_KEYS: PeriodKey[] = [
  'today',
  'thisMonth',
  'last3Months',
  'last6Months',
  'thisYear',
  'allTime',
];

export interface PeriodStarts {
  /** The zone the windows were computed in — the caller's, or UTC if invalid. */
  tz: string;
  instants: Record<PeriodKey, Date | null>;
  days: Record<PeriodKey, string | null>;
}

const DEFAULT_TZ = 'UTC';

/** True when Intl knows the zone. A typo must not turn into a 500. */
export function isValidTimeZone(tz: string | null | undefined): boolean {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimeZone(tz: string | null | undefined): string {
  const trimmed = (tz ?? '').trim();
  return isValidTimeZone(trimmed) ? trimmed : DEFAULT_TZ;
}

interface WallClock {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number;
  minute: number;
  second: number;
}

/** The wall-clock reading in `tz` at a given instant. */
function wallClockAt(instant: Date, tz: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    // 'h23' rather than hour12:false: the latter can yield "24" at midnight
    // on some ICU builds, which Date.UTC would roll into the next day.
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const read = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/** The instant of local midnight on a calendar day in `tz`. */
function zonedMidnight(year: number, month: number, day: number, tz: string): Date {
  // Guess that midnight is at the UTC instant with the same digits, measure
  // how far the zone's wall clock is from that, and correct. One more pass
  // catches a DST change sitting between the guess and the answer.
  const target = Date.UTC(year, month - 1, day, 0, 0, 0);
  let instant = target;
  for (let pass = 0; pass < 2; pass += 1) {
    const wc = wallClockAt(new Date(instant), tz);
    const seen = Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute, wc.second);
    const offset = seen - instant;
    if (offset === 0) break;
    instant = target - offset;
  }
  return new Date(instant);
}

function dayString(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The same day-of-month `n` calendar months earlier, clamped to the shorter
 * month (31 May − 3 months → 29 Feb in a leap year, 28 otherwise).
 *
 * This is the "past 3 months" an owner expects — from the same date last
 * quarter until now — rather than a rolling 90 days.
 */
function monthsBack(year: number, month: number, day: number, n: number) {
  let m = month - n;
  let y = year;
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  return { year: y, month: m, day: Math.min(day, daysInMonth(y, m)) };
}

export function periodStarts(now: Date, tz: string | null | undefined): PeriodStarts {
  const zone = resolveTimeZone(tz);
  const { year, month, day } = wallClockAt(now, zone);

  const three = monthsBack(year, month, day, 3);
  const six = monthsBack(year, month, day, 6);

  const bounds: Record<Exclude<PeriodKey, 'allTime'>, [number, number, number]> = {
    today: [year, month, day],
    thisMonth: [year, month, 1],
    last3Months: [three.year, three.month, three.day],
    last6Months: [six.year, six.month, six.day],
    thisYear: [year, 1, 1],
  };

  const instants = { allTime: null } as Record<PeriodKey, Date | null>;
  const days = { allTime: null } as Record<PeriodKey, string | null>;
  for (const key of Object.keys(bounds) as Array<keyof typeof bounds>) {
    const [y, m, d] = bounds[key];
    instants[key] = zonedMidnight(y, m, d, zone);
    days[key] = dayString(y, m, d);
  }

  return { tz: zone, instants, days };
}
