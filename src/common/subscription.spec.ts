import {
  addDays,
  addMonthsClamped,
  computeNewExpiry,
  daysUntil,
  isIsoDay,
  subscriptionAlertLevel,
} from './subscription';

describe('isIsoDay', () => {
  it('accepts real calendar dates only', () => {
    expect(isIsoDay('2026-10-21')).toBe(true);
    expect(isIsoDay('2028-02-29')).toBe(true);
    expect(isIsoDay('2027-02-29')).toBe(false);
    expect(isIsoDay('2026-13-01')).toBe(false);
    expect(isIsoDay('2026-10-32')).toBe(false);
    expect(isIsoDay('21/10/2026')).toBe(false);
    expect(isIsoDay('2026-10-21T00:00:00Z')).toBe(false);
    expect(isIsoDay(null)).toBe(false);
  });
});

describe('addMonthsClamped', () => {
  it('keeps the day of month when it exists', () => {
    expect(addMonthsClamped('2026-10-21', 1)).toBe('2026-11-21');
    expect(addMonthsClamped('2026-10-21', 3)).toBe('2027-01-21');
    expect(addMonthsClamped('2026-10-21', 12)).toBe('2027-10-21');
  });

  it('clamps to the shorter month', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonthsClamped('2026-03-31', 6)).toBe('2026-09-30');
  });

  it('rolls over the year', () => {
    expect(addMonthsClamped('2026-12-15', 2)).toBe('2027-02-15');
    expect(addMonthsClamped('2026-07-01', 6)).toBe('2027-01-01');
  });
});

describe('addDays / daysUntil', () => {
  it('counts whole calendar days', () => {
    expect(addDays('2026-10-21', 7)).toBe('2026-10-28');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(daysUntil('2026-10-24', '2026-10-21')).toBe(3);
    expect(daysUntil('2026-10-21', '2026-10-21')).toBe(0);
    expect(daysUntil('2026-10-19', '2026-10-21')).toBe(-2);
  });
});

describe('computeNewExpiry', () => {
  const today = '2026-10-21';

  it('counts from today for a store with no expiry', () => {
    expect(computeNewExpiry({ today, current: null, months: 1 })).toBe('2026-11-21');
  });

  it('extends what is left when the store is still paid up', () => {
    expect(computeNewExpiry({ today, current: '2026-11-10', months: 3 })).toBe('2027-02-10');
  });

  it('restarts from today when the store has lapsed', () => {
    expect(computeNewExpiry({ today, current: '2026-09-01', months: 2 })).toBe('2026-12-21');
  });

  it('lets an explicit date win, even a past one', () => {
    expect(computeNewExpiry({ today, current: '2027-01-01', expiresAt: '2026-10-01' })).toBe('2026-10-01');
    expect(computeNewExpiry({ today, current: null, months: 6, expiresAt: '2026-12-31' })).toBe('2026-12-31');
  });

  it('rejects nonsense', () => {
    expect(() => computeNewExpiry({ today, current: null })).toThrow();
    expect(() => computeNewExpiry({ today, current: null, months: 0 })).toThrow();
    expect(() => computeNewExpiry({ today, current: null, months: 1.5 })).toThrow();
    expect(() => computeNewExpiry({ today, current: null, expiresAt: 'tomorrow' })).toThrow();
  });
});

describe('subscriptionAlertLevel', () => {
  it('is silent until three days out, yellow at 3 and 2, red from 1 day through expiry and beyond', () => {
    expect(subscriptionAlertLevel(null)).toBe('none');
    expect(subscriptionAlertLevel(30)).toBe('none');
    expect(subscriptionAlertLevel(4)).toBe('none');
    expect(subscriptionAlertLevel(3)).toBe('warning');
    expect(subscriptionAlertLevel(2)).toBe('warning');
    expect(subscriptionAlertLevel(1)).toBe('critical');
    expect(subscriptionAlertLevel(0)).toBe('critical');
    expect(subscriptionAlertLevel(-10)).toBe('critical');
  });
});
