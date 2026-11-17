/** Indian number formatting: 1234567.8 -> "12,34,567.8". */
export function formatINR(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  const neg = value < 0;
  const fixed = Math.abs(value).toFixed(decimals);
  const [intPart, dec] = fixed.split('.');
  let out: string;
  if (intPart.length <= 3) out = intPart;
  else {
    const last3 = intPart.slice(-3);
    const rest = intPart.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    out = `${rest},${last3}`;
  }
  return `${neg ? '-' : ''}₹${out}${dec ? `.${dec}` : ''}`;
}

/** Money with paise only when needed: 9168.71 -> ₹9,168.71, 137531 -> ₹1,37,531 */
export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return formatINR(value, Number.isInteger(round2(value)) ? 0 : 2);
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Plain number for CSV output: 2 decimals max, no trailing zeros. */
export function csvNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  const r = round2(n);
  return String(r);
}
