import { orderSequenceDay } from './order-sequence-day';

describe('orderSequenceDay', () => {
  // Karachi is UTC+5 all year.
  const at = (iso: string) => new Date(iso);

  it('changes day at the reset hour, not at midnight', () => {
    // 05:59 and 06:00 on 24 Oct in Karachi.
    expect(orderSequenceDay(at('2026-10-24T00:59:00Z'), 6, 'Asia/Karachi')).toBe('2026-10-23');
    expect(orderSequenceDay(at('2026-10-24T01:00:00Z'), 6, 'Asia/Karachi')).toBe('2026-10-24');
  });

  it('keeps a late-night order on the evening it belongs to', () => {
    // 01:30 on 24 Oct in Karachi.
    expect(orderSequenceDay(at('2026-10-23T20:30:00Z'), 6, 'Asia/Karachi')).toBe('2026-10-23');
  });

  it('is the plain calendar day with a midnight reset', () => {
    expect(orderSequenceDay(at('2026-10-23T19:00:00Z'), 0, 'Asia/Karachi')).toBe('2026-10-24');
  });
});
