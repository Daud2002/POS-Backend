import { isValidTimeZone, periodStarts, resolveTimeZone } from './periods';

describe('resolveTimeZone', () => {
  it('keeps a known IANA zone', () => {
    expect(resolveTimeZone('Asia/Karachi')).toBe('Asia/Karachi');
    expect(resolveTimeZone(' Europe/London ')).toBe('Europe/London');
  });

  it('falls back to UTC for anything Intl does not know', () => {
    expect(resolveTimeZone('Not/AZone')).toBe('UTC');
    expect(resolveTimeZone('')).toBe('UTC');
    expect(resolveTimeZone(undefined)).toBe('UTC');
    expect(resolveTimeZone(null)).toBe('UTC');
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});

describe('periodStarts', () => {
  // 14 Sep 2026, 03:30 UTC = 08:30 in Karachi (UTC+5, no DST).
  const now = new Date('2026-09-14T03:30:00.000Z');

  it('computes every window at local midnight in the caller zone', () => {
    const p = periodStarts(now, 'Asia/Karachi');
    expect(p.tz).toBe('Asia/Karachi');
    expect(p.days).toEqual({
      today: '2026-09-14',
      thisMonth: '2026-09-01',
      last3Months: '2026-06-14',
      last6Months: '2026-03-14',
      thisYear: '2026-01-01',
      allTime: null,
    });
    // Karachi midnight is 19:00 UTC the previous evening.
    expect(p.instants.today?.toISOString()).toBe('2026-09-13T19:00:00.000Z');
    expect(p.instants.thisMonth?.toISOString()).toBe('2026-08-31T19:00:00.000Z');
    expect(p.instants.thisYear?.toISOString()).toBe('2025-12-31T19:00:00.000Z');
    expect(p.instants.allTime).toBeNull();
  });

  it('is a different calendar day west of the meridian at the same instant', () => {
    // 03:30 UTC on the 14th is still the evening of the 13th in Los Angeles.
    const p = periodStarts(now, 'America/Los_Angeles');
    expect(p.days.today).toBe('2026-09-13');
    // PDT is UTC-7 in September.
    expect(p.instants.today?.toISOString()).toBe('2026-09-13T07:00:00.000Z');
  });

  it('uses UTC when the zone is unknown', () => {
    const p = periodStarts(now, 'Nowhere/Land');
    expect(p.tz).toBe('UTC');
    expect(p.days.today).toBe('2026-09-14');
    expect(p.instants.today?.toISOString()).toBe('2026-09-14T00:00:00.000Z');
  });

  it('rolls the year back for windows that cross 1 January', () => {
    const p = periodStarts(new Date('2026-02-10T12:00:00.000Z'), 'UTC');
    expect(p.days.last3Months).toBe('2025-11-10');
    expect(p.days.last6Months).toBe('2025-08-10');
    expect(p.days.thisYear).toBe('2026-01-01');
  });

  it('clamps the day when the earlier month is shorter', () => {
    // 31 May − 3 months is "31 Feb", which does not exist.
    const p = periodStarts(new Date('2026-05-31T12:00:00.000Z'), 'UTC');
    expect(p.days.last3Months).toBe('2026-02-28');
    expect(p.days.last6Months).toBe('2025-11-30');
  });

  it('lands on the right instant across a DST change', () => {
    // 15 April 2026 in London is BST (UTC+1); "6 months back" is 15 October
    // 2025, also BST; "this year" starts in GMT (UTC+0).
    const p = periodStarts(new Date('2026-04-15T10:00:00.000Z'), 'Europe/London');
    expect(p.instants.today?.toISOString()).toBe('2026-04-14T23:00:00.000Z');
    expect(p.instants.thisYear?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(p.days.last6Months).toBe('2025-10-15');
    expect(p.instants.last6Months?.toISOString()).toBe('2025-10-14T23:00:00.000Z');
  });

  it('handles a zone that is ahead of UTC by a non-whole hour', () => {
    // Kolkata is UTC+5:30.
    const p = periodStarts(now, 'Asia/Kolkata');
    expect(p.days.today).toBe('2026-09-14');
    expect(p.instants.today?.toISOString()).toBe('2026-09-13T18:30:00.000Z');
  });
});
