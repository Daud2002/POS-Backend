/**
 * A phone number reduced to what identifies it: digits, plus a leading '+'.
 *
 * Cashiers type numbers however they like — '0300-1234567', '0300 1234567',
 * '(0300) 1234567' — and all of them must find the same customer. Anything
 * that is not a digit is dropped; a '+' survives only at the very front so
 * '+92 300 1234567' keeps its country code.
 *
 * Returns '' for input with no digits at all, which callers treat as "no
 * phone given".
 */
export function normalizePhone(raw: string | null | undefined): string {
  const text = (raw ?? '').trim();
  if (!text) return '';
  const digits = text.replace(/[^0-9]/g, '');
  if (!digits) return '';
  return text.startsWith('+') ? `+${digits}` : digits;
}

/**
 * The SQL equivalent of normalizePhone(), for comparing against rows that
 * were stored before normalisation existed. Postgres regexp_replace with the
 * 'g' flag strips everything except digits and '+' — close enough that a
 * legacy '+92-300' row still matches a normalised '+92300'.
 */
export const SQL_NORMALIZED_PHONE = (column: string) =>
  `regexp_replace(${column}, '[^0-9+]', '', 'g')`;
