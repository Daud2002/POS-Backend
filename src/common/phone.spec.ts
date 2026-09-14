import { normalizePhone } from './phone';

describe('normalizePhone', () => {
  it('strips separators so the same number always matches', () => {
    expect(normalizePhone('0300-1234567')).toBe('03001234567');
    expect(normalizePhone('0300 1234567')).toBe('03001234567');
    expect(normalizePhone('(0300) 123-4567')).toBe('03001234567');
    expect(normalizePhone('  03001234567  ')).toBe('03001234567');
  });

  it('keeps a leading plus and only a leading plus', () => {
    expect(normalizePhone('+92 300 1234567')).toBe('+923001234567');
    expect(normalizePhone('0300+1234567')).toBe('03001234567');
  });

  it('is empty when there are no digits to keep', () => {
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone('   ')).toBe('');
    expect(normalizePhone('+')).toBe('');
    expect(normalizePhone('n/a')).toBe('');
    expect(normalizePhone(null)).toBe('');
    expect(normalizePhone(undefined)).toBe('');
  });
});
